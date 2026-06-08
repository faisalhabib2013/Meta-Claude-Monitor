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
    const { runMonitoringCycle } = require('./cppEngine');
    await runMonitoringCycle();
  } catch (err) {
    logger.error('Hourly monitor failed', err);
  } finally {
    isMonitoringRunning = false;
  }
}

function startHourlyMonitor() {
  // تشغيل فوري أول مرة
  runHourlyMonitor();

  // ثم كل 90 دقيقة
  monitoringTimer = setInterval(runHourlyMonitor, config.monitor.intervalMs);
  logger.success(`Hourly monitor started (interval: ${config.monitor.intervalMs / 60000} min)`);
}

// ==================== التقرير اليومي (11 مساءً بتوقيت القاهرة = 9 UTC) ====================

function scheduleDailyReport() {
  // '0 21 * * *' = 9 PM UTC = 11 PM Cairo (UTC+2)
  const cronExpr = `${config.schedule.dailyReportMinute} ${config.schedule.dailyReportHour} * * *`;

  cron.schedule(cronExpr, async () => {
    logger.info('Running daily report...');
    try {
      const { checkConsecutiveBreaches } = require('./cppEngine');
      const { generateDailyReport } = require('./ai/dailyReport');
      const { generateDeepAnalysis } = require('./ai/deepAnalysis');
      const { sendDailyReport, sendDeepAnalysis } = require('./telegram/alerts');

      // 1. توليد وإرسال التقرير اليومي
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
  }, { timezone: 'UTC' });

  logger.success(`Daily report scheduled: ${cronExpr} UTC (11 PM Cairo)`);
}

// تشغيل التحليل العميق لمنتج
async function runDeepAnalysisForProduct(breach, generateDeepAnalysis, sendDeepAnalysis) {
  try {
    logger.info(`Deep analysis for: ${breach.product_name}`);

    // إيجاد الـ campaign IDs للمنتج
    const today = todayString();
    const metrics = db.getDailyMetricsByProduct(breach.product_name, daysAgoString(1), today);
    const uniqueCampaigns = [...new Set(metrics.map(m => m.campaign_id))];
    const accountId = metrics[0]?.account_id;

    if (!uniqueCampaigns.length || !accountId) return;

    const analysis = await generateDeepAnalysis(
      breach.product_name, accountId, uniqueCampaigns
    );

    await sendDeepAnalysis(breach.product_name, analysis);
    logger.success(`Deep analysis sent for: ${breach.product_name}`);

  } catch (err) {
    logger.error(`Deep analysis failed for ${breach.product_name}`, err);
  }
}

// ==================== تقرير الـ 3 أيام ====================

function scheduleTriDayReport() {
  // فحص كل يوم هل مرت 3 أيام من آخر تقرير
  cron.schedule('30 21 * * *', async () => {
    try {
      const lastRun = parseInt(db.getState('last_triday_report', '0'));
      const threeDaysMs = config.schedule.triDayReportIntervalDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      if (now - lastRun < threeDaysMs) {
        logger.info(`Tri-day report: ${Math.round((threeDaysMs - (now - lastRun)) / 3600000)}h remaining`);
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
  }, { timezone: 'UTC' });

  // إعداد أول تشغيل لو مفيش تاريخ مسجل
  const lastRun = db.getState('last_triday_report');
  if (!lastRun) {
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
      logger.error('Meta token is INVALID');
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

  // فحص Token عند بدء التشغيل
  setTimeout(checkTokenExpiry, 5000);

  logger.success('All schedulers started successfully');
}

function stopAll() {
  if (monitoringTimer) {
    clearInterval(monitoringTimer);
    monitoringTimer = null;
  }
  logger.info('All schedulers stopped');
}

module.exports = { startAll, stopAll };
