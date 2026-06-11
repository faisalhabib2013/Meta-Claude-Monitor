const cron = require('node-cron');
const config = require('./config');
const db = require('./db');
const logger = require('./utils/logger');
const { todayString, daysAgoString } = require('./utils/time');

let monitoringTimer = null;
let isMonitoringRunning = false;

// ==================== الفحص الساعي (كل 90 دقيقة) ====================

async function runHourlyMonitor() {
  if (isMonitoringRunning) {
    logger.warn('Monitor cycle already running, skipping...');
    return;
  }
  isMonitoringRunning = true;
  try {
    const { runMonitoringCycle, runTiktokMonitoringCycle } = require('./cppEngine');

    // Meta Ads — scaledThisCycle مشتركة بين المنصتين لمنع تكرار نفس المنتج
    const scaledThisCycle = new Set();
    const metaAlerts = await runMonitoringCycle(scaledThisCycle);

    // TikTok Ads (لو متفعّل) — نفس الـ Set
    const tiktokAlerts = config.tiktok.advertiserIds?.length > 0
      ? await runTiktokMonitoringCycle(scaledThisCycle)
      : 0;

    logger.info(`Cycle complete — Meta: ${metaAlerts} alerts | TikTok: ${tiktokAlerts} alerts`);
  } catch (err) {
    logger.error('Hourly monitor failed', err);
  } finally {
    isMonitoringRunning = false;
  }
}

function startHourlyMonitor() {
  runHourlyMonitor(); // تشغيل فوري
  monitoringTimer = setInterval(runHourlyMonitor, config.monitor.intervalMs);
  logger.success(`Hourly monitor started (interval: ${config.monitor.intervalMs / 60000} min)`);
}

// ==================== التقرير اليومي (10:30 مساءً بتوقيت القاهرة) ====================
// نستخدم Africa/Cairo مباشرة لتجنب مشكلة التوقيت الصيفي/الشتوي

function scheduleDailyReport() {
  // 22:30 بتوقيت القاهرة — node-cron يتعامل مع DST تلقائياً
  cron.schedule('30 22 * * *', async () => {
    logger.info('Running daily report (10:30 PM Cairo)...');
    try {
      const { checkConsecutiveBreaches } = require('./cppEngine');
      const { generateDailyReport } = require('./ai/dailyReport');
      const { generateDeepAnalysis } = require('./ai/deepAnalysis');
      const { sendDailyReport, sendDeepAnalysis } = require('./telegram/alerts');

      // 1. التقرير اليومي
      const report = await generateDailyReport();
      await sendDailyReport(report);
      logger.success('Daily report sent');

      // 2. فحص التجاوزات المتتالية
      const productsBreach = await checkConsecutiveBreaches();

      // 3. تحليل عميق للمنتجات التي تجاوزت يومين
      for (const breach of productsBreach) {
        await runDeepAnalysisForProduct(breach, generateDeepAnalysis, sendDeepAnalysis);
        db.markAnalysisDone(breach.product_name, breach.today_date);
      }

      // 4. فحص صلاحية الـ Token
      await checkTokenExpiry();

    } catch (err) {
      logger.error('Daily report pipeline failed', err);
    }
  }, { timezone: 'Africa/Cairo' });

  logger.success('Daily report scheduled: 10:30 PM Cairo (Africa/Cairo timezone)');
}

// تشغيل التحليل العميق لمنتج
async function runDeepAnalysisForProduct(breach, generateDeepAnalysis, sendDeepAnalysis) {
  try {
    logger.info(`Deep analysis for: ${breach.product_name}`);
    const today = todayString();
    const metrics = db.getDailyMetricsByProduct(breach.product_name, daysAgoString(1), today);
    const uniqueCampaigns = [...new Set(metrics.map(m => m.campaign_id))];
    const accountId = metrics[0]?.account_id;
    if (!uniqueCampaigns.length || !accountId) return;

    const analysis = await generateDeepAnalysis(breach.product_name, accountId, uniqueCampaigns);
    await sendDeepAnalysis(breach.product_name, analysis);
    logger.success(`Deep analysis sent for: ${breach.product_name}`);
  } catch (err) {
    logger.error(`Deep analysis failed for ${breach.product_name}`, err);
  }
}

// ==================== تقرير الـ 3 أيام ====================

function scheduleTriDayReport() {
  cron.schedule('0 23 * * *', async () => {
    try {
      const lastRun = parseInt(db.getState('last_triday_report', '0'));
      const threeDaysMs = config.schedule.triDayReportIntervalDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      if (now - lastRun < threeDaysMs) {
        const hRemaining = Math.round((threeDaysMs - (now - lastRun)) / 3600000);
        logger.info(`Tri-day report: ${hRemaining}h remaining`);
        return;
      }

      logger.info('Running tri-day report...');
      const { generateTriDayReport } = require('./ai/triDayReport');
      const { sendTriDayReport } = require('./telegram/alerts');

      const report = await generateTriDayReport();
      await sendTriDayReport(report);
      db.setState('last_triday_report', String(now));
      logger.success('Tri-day report sent');
    } catch (err) {
      logger.error('Tri-day report failed', err);
    }
  }, { timezone: 'Africa/Cairo' });

  if (!db.getState('last_triday_report')) {
    db.setState('last_triday_report', String(Date.now()));
    logger.info('Tri-day report timer initialized (first run in 3 days)');
  }
  logger.success('Tri-day report scheduler started');
}

// ==================== فحص صلاحية الـ Token ====================

async function checkTokenExpiry() {
  try {
    const { checkTokenValidity } = require('./meta/client');
    const { sendTokenExpiryWarning } = require('./telegram/alerts');
    const { valid, daysLeft, neverExpires } = await checkTokenValidity();
    if (!valid) {
      await sendTokenExpiryWarning(0);
    } else if (!neverExpires && daysLeft <= 7) {
      await sendTokenExpiryWarning(daysLeft);
      logger.warn(`Meta token expires in ${daysLeft} days`);
    }
  } catch (err) {
    logger.error('Token check failed', err);
  }
}

// ==================== بدء كل المهام ====================

function startAll() {
  startHourlyMonitor();
  scheduleDailyReport();
  scheduleTriDayReport();
  setTimeout(checkTokenExpiry, 5000);
  logger.success('All schedulers started successfully');
}

function stopAll() {
  if (monitoringTimer) { clearInterval(monitoringTimer); monitoringTimer = null; }
  logger.info('All schedulers stopped');
}

// تشغيل دورة فورية يدوياً (من أمر /check)
async function triggerManualCheck() {
  await runHourlyMonitor();
}

module.exports = { startAll, stopAll, triggerManualCheck };
