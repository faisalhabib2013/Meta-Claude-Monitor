const config = require('./config');
const db = require('./db');
const { getAccountInsightsToday } = require('./meta/insights');
const { getActiveAdsets } = require('./meta/campaigns');
const { parseInsights, shouldAlert } = require('./utils/metrics');
const { sendCppAlert } = require('./telegram/alerts');
const { todayString } = require('./utils/time');
const logger = require('./utils/logger');

// جلب قائمة المنتجات
function loadProducts() {
  return require('../config/products.json').products;
}

// إيجاد المنتج المناسب لاسم حملة معين
function matchProduct(campaignName, products) {
  if (!campaignName) return null;
  const lowerName = campaignName.toLowerCase();
  return products.find(p => campaignName.includes(p.name)) || null;
}

// الدورة الرئيسية للمراقبة
async function runMonitoringCycle() {
  logger.info('=== Starting monitoring cycle ===');
  const products = loadProducts();
  const today = todayString();
  let totalAlerts = 0;

  for (const accountId of config.meta.adAccountIds) {
    try {
      logger.info(`Processing account: ${accountId}`);

      // جلب الـ adsets الفعالة مع بياناتها
      const [adsets, insights] = await Promise.all([
        getActiveAdsets(accountId),
        getAccountInsightsToday(accountId)
      ]);

      // فهرسة الـ adsets للوصول السريع
      const adsetMap = {};
      for (const adset of adsets) {
        adsetMap[adset.id] = adset;
      }

      // معالجة كل صف من الـ insights
      for (const row of insights) {
        const adsetId = row.adset_id;
        const adset = adsetMap[adsetId];

        // تجاهل الـ adsets المتوقفة يدوياً (غير موجودة في adsetMap)
        if (!adset) continue;

        // إيجاد المنتج
        const product = matchProduct(row.campaign_name, products);
        if (!product) continue;

        // حساب الـ metrics
        const metrics = parseInsights(row);

        // تجاهل لو الإنفاق صفر
        if (metrics.spend === 0) continue;

        // حفظ البيانات في DB
        db.upsertDailyMetrics(today, adsetId, {
          productName: product.name,
          accountId,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          adsetId: row.adset_id,
          adsetName: adset.name,
          spend: metrics.spend,
          purchases: metrics.purchases,
          cpp: metrics.costPerPurchase,
          maxCpp: product.maxCpp,
          impressions: metrics.impressions,
          frequency: metrics.frequency,
          ctr: metrics.ctr,
          cpm: metrics.cpm,
          clicks: metrics.clicks,
          addToCart: metrics.addToCart,
          checkouts: metrics.checkouts,
          lpViews: metrics.lpViews,
          threeSPlays: metrics.threeSPlays,
          thruPlays: metrics.thruPlays,
          hookRate: metrics.hookRate,
          holdRate: metrics.holdRate,
          purchaseRoas: metrics.purchaseRoas,
          thresholdExceeded: 0
        });

        // هل يجب التنبيه؟
        const alertDecision = shouldAlert(metrics, product, config);

        if (alertDecision.trigger) {
          // هل مر وقت كافٍ من آخر تنبيه؟ (cooldown 3 ساعات)
          const recentlyAlerted = db.wasAlertedRecently(
            adsetId, product.name, config.monitor.alertCooldownMs
          );

          if (!recentlyAlerted) {
            logger.alert(
              `ALERT: ${product.name} - ${adset.name} | CPP: ${metrics.costPerPurchase.toFixed(2)} | Spend: ${metrics.spend}`
            );

            // تحديث DB بالتجاوز
            db.upsertDailyMetrics(today, adsetId, {
              productName: product.name,
              accountId,
              campaignId: row.campaign_id,
              campaignName: row.campaign_name,
              adsetId: row.adset_id,
              adsetName: adset.name,
              spend: metrics.spend,
              purchases: metrics.purchases,
              cpp: metrics.costPerPurchase,
              maxCpp: product.maxCpp,
              impressions: metrics.impressions,
              frequency: metrics.frequency,
              ctr: metrics.ctr,
              cpm: metrics.cpm,
              clicks: metrics.clicks,
              addToCart: metrics.addToCart,
              checkouts: metrics.checkouts,
              lpViews: metrics.lpViews,
              threeSPlays: metrics.threeSPlays,
              thruPlays: metrics.thruPlays,
              hookRate: metrics.hookRate,
              holdRate: metrics.holdRate,
              purchaseRoas: metrics.purchaseRoas,
              thresholdExceeded: 1
            });

            // إرسال التنبيه
            await sendCppAlert({
              product,
              campaign: { id: row.campaign_id, name: row.campaign_name },
              adset: { id: adset.id, name: adset.name, daily_budget: adset.daily_budget },
              metrics,
              alertInfo: alertDecision,
              accountId
            });

            // تسجيل التنبيه في DB
            db.logAlert(product.name, adsetId, 'hourly', alertDecision.reason);
            totalAlerts++;

            // تأخير بين التنبيهات لتجنب spam
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      logger.info(`Account ${accountId}: processed ${insights.length} active adsets`);
    } catch (err) {
      if (err.message === 'META_TOKEN_EXPIRED') {
        const { sendTokenExpiryWarning } = require('./telegram/alerts');
        await sendTokenExpiryWarning(0);
        logger.error('Meta token expired!');
        return;
      }
      logger.error(`Error processing account ${accountId}`, err);
    }
  }

  logger.info(`=== Monitoring cycle complete. Alerts sent: ${totalAlerts} ===`);
  return totalAlerts;
}

// فحص يومي للتجاوزات المتتالية (يُشغَّل مع التقرير اليومي)
async function checkConsecutiveBreaches() {
  const products = loadProducts();
  const today = todayString();
  const yesterday = require('./utils/time').yesterdayString();

  const allMetrics = db.getAllProductsToday(today);

  for (const row of allMetrics) {
    const product = products.find(p => p.name === row.product_name);
    if (!product) continue;

    const cpp = row.total_purchases > 0 ? row.total_spend / row.total_purchases : 0;
    const exceeded = cpp > product.maxCpp * config.monitor.cppBuffer;

    if (exceeded) {
      db.recordBreach(
        row.product_name, today,
        row.total_spend, row.total_purchases, cpp
      );
    }
  }

  // إيجاد المنتجات التي تحتاج تحليل عميق (يومين متتاليين)
  const needsAnalysis = db.getProductsNeedingAnalysis(today, yesterday);
  logger.info(`Products needing deep analysis: ${needsAnalysis.length}`);

  return needsAnalysis;
}

module.exports = { runMonitoringCycle, checkConsecutiveBreaches, matchProduct };
