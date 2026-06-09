const { tiktokPost } = require('./client');
const logger = require('../utils/logger');
const { todayString, daysAgoString } = require('../utils/time');

// الـ Metrics المطلوبة من TikTok Reporting API
const TIKTOK_METRICS = [
  'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'frequency', 'reach',
  'conversion', 'cost_per_conversion', 'conversion_rate',
  'purchase_roas', 'total_purchase_value',
  'add_to_cart', 'checkout',
  'video_watched_2s', 'video_watched_6s', 'video_play_complete_rate',
  'result', 'cost_per_result'
];

// جلب insights اليوم لكل الـ Ad Groups في حساب
async function getAdgroupInsightsToday(advertiserId) {
  const today = todayString();
  try {
    const body = {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      dimensions: ['adgroup_id', 'campaign_id'],
      metrics: TIKTOK_METRICS,
      data_level: 'AUCTION_ADGROUP',
      start_date: today,
      end_date: today,
      page: 1,
      page_size: 200,
      filtering: [{ field_name: 'adgroup_status', filter_type: 'IN', filter_value: '["STATUS_ENABLE"]' }]
    };

    const data = await tiktokPost('/report/integrated/get/', body);
    const list = data.data?.list || [];

    // فلترة السجلات بدون إنفاق
    return list.filter(row => parseFloat(row.metrics?.spend || 0) > 0);
  } catch (err) {
    logger.error(`TikTok insights failed for advertiser ${advertiserId}`, err);
    return [];
  }
}

// جلب insights تاريخية (للتحليل العميق)
async function getHistoricalAdgroupInsights(advertiserId, adgroupIds, fromDate, toDate) {
  try {
    const body = {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      dimensions: ['adgroup_id', 'stat_time_day'],
      metrics: TIKTOK_METRICS,
      data_level: 'AUCTION_ADGROUP',
      start_date: fromDate,
      end_date: toDate,
      page: 1,
      page_size: 500,
      filtering: [{
        field_name: 'adgroup_ids',
        filter_type: 'IN',
        filter_value: JSON.stringify(adgroupIds)
      }]
    };

    const data = await tiktokPost('/report/integrated/get/', body);
    return data.data?.list || [];
  } catch (err) {
    logger.error('TikTok historical insights failed', err);
    return [];
  }
}

// تحويل بيانات TikTok لنفس تنسيق Meta
function parseTiktokInsights(row) {
  const m = row.metrics || {};
  const spend = parseFloat(m.spend || 0);
  const impressions = parseInt(m.impressions || 0);
  const frequency = parseFloat(m.frequency || 0);
  const reach = parseInt(m.reach || 0);
  const clicks = parseInt(m.clicks || 0);
  const ctr = parseFloat(m.ctr || 0); // TikTok returns as percentage
  const cpm = parseFloat(m.cpm || 0);

  const purchases = parseFloat(m.conversion || 0);
  const costPerPurchase = purchases > 0
    ? (parseFloat(m.cost_per_conversion || 0) || spend / purchases)
    : 0;

  const purchaseValue = parseFloat(m.total_purchase_value || 0);
  const purchaseRoas = parseFloat(m.purchase_roas || 0);
  const addToCart = parseFloat(m.add_to_cart || 0);
  const checkouts = parseFloat(m.checkout || 0);
  const lpViews = 0; // TikTok لا يتتبع LP views بنفس طريقة Meta
  const costPerATC = addToCart > 0 ? spend / addToCart : 0;

  // مقاييس الفيديو — TikTok يستخدم 2s بدل 3s
  const threeSPlays = parseFloat(m.video_watched_2s || 0); // 2s equivalent
  const completionRate = parseFloat(m.video_play_complete_rate || 0);
  const thruPlays = impressions > 0 ? (completionRate / 100) * impressions : 0;

  const hookRate = impressions > 0 ? (threeSPlays / impressions) * 100 : 0;
  const holdRate = completionRate; // already as %
  const ctaRate = thruPlays > 0 ? (clicks / thruPlays) * 100 : 0;
  const purchaseRateLP = 0;
  const lpViewRate = 0;

  return {
    spend, impressions, frequency, reach, clicks, ctr, cpm,
    cpc: clicks > 0 ? spend / clicks : 0,
    purchases, costPerPurchase, purchaseValue, purchaseRoas,
    addToCart, costPerATC, checkouts, lpViews,
    threeSPlays, thruPlays, hookRate, holdRate, ctaRate,
    purchaseRateLP, lpViewRate,
    results: purchases
  };
}

module.exports = { getAdgroupInsightsToday, getHistoricalAdgroupInsights, parseTiktokInsights };
