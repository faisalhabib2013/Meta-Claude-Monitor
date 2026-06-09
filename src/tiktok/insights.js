const { tiktokGet } = require('./client');
const logger = require('../utils/logger');
const { todayString, daysAgoString } = require('../utils/time');

// Metrics مضمونة الصحة في TikTok API v1.3
const TIKTOK_METRICS = [
  'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'frequency', 'reach',
  'conversion', 'cost_per_conversion', 'conversion_rate',
  'total_purchase_value', 'purchase_roas',
  'add_to_cart', 'checkout',
  'video_watched_2s', 'video_watched_6s', 'video_play_complete_rate'
];

// جلب insights اليوم — GET request (ليس POST)
async function getAdgroupInsightsToday(advertiserId) {
  const today = todayString();
  try {
    const data = await tiktokGet('/report/integrated/get/', {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      dimensions: JSON.stringify(['adgroup_id', 'campaign_id']),
      metrics: JSON.stringify(TIKTOK_METRICS),
      data_level: 'AUCTION_ADGROUP',
      start_date: today,
      end_date: today,
      page: 1,
      page_size: 200
    });

    const list = data.data?.list || [];
    return list.filter(row => parseFloat(row.metrics?.spend || 0) > 0);
  } catch (err) {
    // بعض الـ metrics قد لا تكون متاحة — نحاول بـ metrics أساسية فقط
    if (err.message?.includes('40002')) {
      return await getAdgroupInsightsFallback(advertiserId, today);
    }
    logger.error(`TikTok insights failed for advertiser ${advertiserId}`, err);
    return [];
  }
}

// Fallback بـ metrics أساسية فقط لو بعضها غير مدعوم
async function getAdgroupInsightsFallback(advertiserId, today) {
  const basicMetrics = [
    'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'frequency',
    'conversion', 'cost_per_conversion', 'total_purchase_value'
  ];
  try {
    logger.warn(`[TikTok] Using fallback metrics for ${advertiserId}`);
    const data = await tiktokGet('/report/integrated/get/', {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      dimensions: JSON.stringify(['adgroup_id', 'campaign_id']),
      metrics: JSON.stringify(basicMetrics),
      data_level: 'AUCTION_ADGROUP',
      start_date: today,
      end_date: today,
      page: 1,
      page_size: 200
    });
    const list = data.data?.list || [];
    return list.filter(row => parseFloat(row.metrics?.spend || 0) > 0);
  } catch (err) {
    logger.error(`TikTok fallback insights failed for ${advertiserId}`, err);
    return [];
  }
}

// جلب insights تاريخية (للتحليل العميق)
async function getHistoricalAdgroupInsights(advertiserId, adgroupIds, fromDate, toDate) {
  try {
    const data = await tiktokGet('/report/integrated/get/', {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      dimensions: JSON.stringify(['adgroup_id', 'stat_time_day']),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'ctr', 'cpm',
        'frequency', 'conversion', 'cost_per_conversion', 'video_watched_2s',
        'video_play_complete_rate']),
      data_level: 'AUCTION_ADGROUP',
      start_date: fromDate,
      end_date: toDate,
      page: 1,
      page_size: 500
    });
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
  const clicks = parseInt(m.clicks || 0);
  const ctr = parseFloat(m.ctr || 0);
  const cpm = parseFloat(m.cpm || 0);

  const purchases = parseFloat(m.conversion || 0);
  const costPerPurchase = purchases > 0
    ? (parseFloat(m.cost_per_conversion || 0) || spend / purchases)
    : 0;
  const purchaseValue = parseFloat(m.total_purchase_value || 0);
  const purchaseRoas = parseFloat(m.purchase_roas || 0);
  const addToCart = parseFloat(m.add_to_cart || 0);
  const checkouts = parseFloat(m.checkout || 0);

  // مقاييس الفيديو — TikTok يستخدم 2s كحد أدنى
  const threeSPlays = parseFloat(m.video_watched_2s || 0);
  const completionRate = parseFloat(m.video_play_complete_rate || 0);
  const thruPlays = completionRate > 0 && impressions > 0
    ? (completionRate / 100) * impressions : 0;

  const hookRate = impressions > 0 ? (threeSPlays / impressions) * 100 : 0;
  const holdRate = completionRate;
  const ctaRate = thruPlays > 0 ? (clicks / thruPlays) * 100 : 0;
  const costPerATC = addToCart > 0 ? spend / addToCart : 0;

  return {
    spend, impressions, frequency, reach: 0, clicks, ctr, cpm,
    cpc: clicks > 0 ? spend / clicks : 0,
    purchases, costPerPurchase, purchaseValue, purchaseRoas,
    addToCart, costPerATC, checkouts, lpViews: 0,
    threeSPlays, thruPlays, hookRate, holdRate, ctaRate,
    purchaseRateLP: 0, lpViewRate: 0, results: purchases
  };
}

module.exports = { getAdgroupInsightsToday, getHistoricalAdgroupInsights, parseTiktokInsights };
