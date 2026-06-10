const config = require('./config');
const db = require('./db');
const { getAccountInsightsToday } = require('./meta/insights');
const { getActiveAdsets } = require('./meta/campaigns');
const { parseInsights, shouldAlert } = require('./utils/metrics');
const { sendCppAlert, sendScaleAlert } = require('./telegram/alerts');
const { todayString } = require('./utils/time');
const logger = require('./utils/logger');

// TikTok
const { getAdgroupInsightsToday, parseTiktokInsights } = require('./tiktok/insights');
const { getActiveAdgroups, getActiveCampaigns } = require('./tiktok/campaigns');

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

// تتبع الحملات غير المطابقة (لمساعدة في الـ Debug)
const loggedUnmatched = new Set();

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
        if (!product) {
          // تسجيل الحملات غير المطابقة (مرة واحدة فقط لكل حملة)
          if (!loggedUnmatched.has(row.campaign_id)) {
            loggedUnmatched.add(row.campaign_id);
            logger.warn(`Unmatched campaign: "${row.campaign_name}" — لم يُطابَق بأي منتج في products.json`);
          }
          continue;
        }

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

        // ====== Meta Scale Opportunity ======
        const isScaleOpportunity =
          metrics.purchases >= 2 &&
          metrics.costPerPurchase > 0 &&
          metrics.costPerPurchase < product.maxCpp * 0.60 &&
          metrics.spend >= product.maxCpp * 0.30;

        if (isScaleOpportunity) {
          const scaleAlerted = db.wasScaleAlertedRecently(adsetId, product.name, 8 * 60 * 60 * 1000);
          if (!scaleAlerted) {
            await sendScaleAlert({
              product,
              campaign: { id: row.campaign_id, name: row.campaign_name },
              adset: { id: adset.id, name: adset.name, daily_budget: adset.daily_budget },
              metrics,
              accountId,
              platform: 'meta'
            });
            db.logAlert(product.name, adsetId, 'scale', 'scale_opportunity');
            await new Promise(r => setTimeout(r, 500));
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

// ==================== TikTok Monitoring ====================

async function runTiktokMonitoringCycle() {
  if (!config.tiktok.advertiserIds || config.tiktok.advertiserIds.length === 0) return 0;

  const products = loadProducts();
  const today = todayString();
  let totalAlerts = 0;

  for (const advertiserId of config.tiktok.advertiserIds) {
    try {
      logger.info(`[TikTok] Processing advertiser: ${advertiserId}`);

      // جلب الـ Campaigns والـ Ad Groups والـ Insights
      const [campaigns, adgroups, insights] = await Promise.all([
        getActiveCampaigns(advertiserId),
        getActiveAdgroups(advertiserId),
        getAdgroupInsightsToday(advertiserId)
      ]);

      // فهرسة
      const campaignMap = {};
      campaigns.forEach(c => { campaignMap[c.campaign_id] = c; });
      const adgroupMap = {};
      adgroups.forEach(ag => { adgroupMap[ag.adgroup_id] = ag; });

      let processedCount = 0;

      for (const row of insights) {
        const adgroupId = row.dimensions?.adgroup_id;
        if (!adgroupId) continue;

        const adgroup = adgroupMap[adgroupId];
        // campaign_id يأتي من بيانات الـ adgroup (ليس من dimensions — غير متوافق مع AUCTION_ADGROUP)
        const campaignId = adgroup?.campaign_id;
        const campaign = campaignMap[campaignId];
        if (!adgroup) continue; // متوقف يدوياً

        const campaignName = campaign?.campaign_name || adgroup.adgroup_name || '';
        const product = matchProduct(campaignName, products)
          || matchProduct(adgroup.adgroup_name, products);

        if (!product) {
          if (!loggedUnmatched.has(`tt_${adgroupId}`)) {
            loggedUnmatched.add(`tt_${adgroupId}`);
            logger.warn(`[TikTok] Unmatched: "${campaignName}" — لم يُطابَق بأي منتج`);
          }
          continue;
        }

        const metrics = parseTiktokInsights(row);
        if (metrics.spend === 0) continue;

        // حفظ في DB
        db.upsertDailyMetrics(today, `tt_${adgroupId}`, {
          productName: product.name,
          accountId: advertiserId,
          campaignId: campaignId || adgroupId,
          campaignName: campaign?.campaign_name || adgroup.adgroup_name,
          adsetId: `tt_${adgroupId}`,
          adsetName: adgroup.adgroup_name,
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
          lpViews: 0,
          threeSPlays: metrics.threeSPlays,
          thruPlays: metrics.thruPlays,
          hookRate: metrics.hookRate,
          holdRate: metrics.holdRate,
          purchaseRoas: metrics.purchaseRoas,
          thresholdExceeded: 0
        });

        processedCount++;

        // هل يجب التنبيه؟
        const alertDecision = shouldAlert(metrics, product, config);
        if (alertDecision.trigger) {
          const recentlyAlerted = db.wasAlertedRecently(
            `tt_${adgroupId}`, product.name, config.monitor.alertCooldownMs
          );
          if (!recentlyAlerted) {
            await sendCppAlert({
              product,
              campaign: { id: campaignId, name: campaign?.campaign_name || adgroup.adgroup_name },
              adset: {
                id: `tt_${adgroupId}`,
                name: adgroup.adgroup_name,
                daily_budget: Math.round((adgroup.budget || 0) * 100) // convert to piastres for uniform display
              },
              metrics,
              alertInfo: { ...alertDecision, advertiserId },
              accountId: advertiserId,
              platform: 'tiktok'
            });
            db.logAlert(product.name, `tt_${adgroupId}`, 'hourly', alertDecision.reason);
            totalAlerts++;
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        // TikTok Scale Opportunity
        const isTikTokScale =
          metrics.purchases >= 2 &&
          metrics.costPerPurchase > 0 &&
          metrics.costPerPurchase < product.maxCpp * 0.60 &&
          metrics.spend >= product.maxCpp * 0.30;

        if (isTikTokScale) {
          const scaleAlerted = db.wasScaleAlertedRecently(`tt_${adgroupId}`, product.name, 8 * 60 * 60 * 1000);
          if (!scaleAlerted) {
            await sendScaleAlert({
              product,
              campaign: { id: campaignId, name: campaign?.campaign_name || adgroup.adgroup_name },
              adset: { id: `tt_${adgroupId}`, name: adgroup.adgroup_name,
                daily_budget: Math.round((adgroup.budget || 0) * 100) },
              metrics,
              accountId: advertiserId,
              platform: 'tiktok'
            });
            db.logAlert(product.name, `tt_${adgroupId}`, 'scale', 'scale_opportunity');
          }
        }
      }

      logger.info(`[TikTok] Advertiser ${advertiserId}: processed ${processedCount} active adgroups`);
    } catch (err) {
      if (err.message === 'TIKTOK_TOKEN_EXPIRED') {
        const { broadcast } = require('./telegram/bot');
        await broadcast('⚠️ *TikTok Token منتهي!*\n\nيجب تجديده من:\nhttps://business-api.tiktok.com/portal/auth');
        return totalAlerts;
      }
      logger.error(`[TikTok] Error for advertiser ${advertiserId}`, err);
    }
  }

  return totalAlerts;
}

module.exports = { runMonitoringCycle, runTiktokMonitoringCycle, checkConsecutiveBreaches, matchProduct };
