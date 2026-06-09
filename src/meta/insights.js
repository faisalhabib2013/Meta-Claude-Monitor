const { metaGetAll, metaGet } = require('./client');
const logger = require('../utils/logger');

// الـ fields المطلوبة من insights API
// ملاحظة: video_p3_watched_actions أُزيل لأنه غير صالح في v20+
// ثلاث ثواني من مشاهدة الفيديو تُستخرج من actions (action_type: video_view)
const INSIGHTS_FIELDS = [
  'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'spend', 'impressions', 'frequency', 'reach', 'clicks',
  'ctr', 'cpm', 'cpc',
  'actions', 'cost_per_action_type', 'action_values',
  'purchase_roas', 'website_purchase_roas',
  'video_thruplay_watched_actions'
].join(',');

// جلب insights لكل الـ adsets في حساب بشكل batch (فعّال جداً)
async function getAccountInsightsToday(accountId) {
  try {
    const data = await metaGetAll(`/act_${accountId}/insights`, {
      fields: INSIGHTS_FIELDS,
      level: 'adset',
      date_preset: 'today',
      filtering: JSON.stringify([
        { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }
      ]),
      limit: 200
    });

    // فلترة السجلات بدون إنفاق
    return data.filter(row => parseFloat(row.spend || 0) > 0);
  } catch (err) {
    logger.error(`Failed to get insights for account ${accountId}`, err);
    return [];
  }
}

// جلب insights تاريخية لمنتج معين (للتحليل العميق)
async function getHistoricalInsights(accountId, campaignIds, fromDate, toDate) {
  try {
    const data = await metaGetAll(`/act_${accountId}/insights`, {
      fields: INSIGHTS_FIELDS,
      level: 'adset',
      time_range: JSON.stringify({ since: fromDate, until: toDate }),
      time_increment: 7, // بيانات أسبوعية
      filtering: JSON.stringify([
        { field: 'campaign.id', operator: 'IN', value: campaignIds }
      ]),
      limit: 500
    });

    return data;
  } catch (err) {
    logger.error(`Failed to get historical insights`, err);
    return [];
  }
}

// جلب insights على مستوى الحملة (للتقرير اليومي)
async function getCampaignInsightsToday(accountId) {
  try {
    const data = await metaGetAll(`/act_${accountId}/insights`, {
      fields: INSIGHTS_FIELDS,
      level: 'campaign',
      date_preset: 'today',
      filtering: JSON.stringify([
        { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] }
      ]),
      limit: 200
    });

    return data.filter(row => parseFloat(row.spend || 0) > 0);
  } catch (err) {
    logger.error(`Failed to get campaign insights for account ${accountId}`, err);
    return [];
  }
}

module.exports = {
  getAccountInsightsToday,
  getHistoricalInsights,
  getCampaignInsightsToday
};
