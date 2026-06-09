const { tiktokGetAllPages } = require('./client');
const logger = require('../utils/logger');

// جلب الـ Ad Groups الفعالة مع أسماء الـ Campaigns
async function getActiveAdgroups(advertiserId) {
  try {
    const adgroups = await tiktokGetAllPages('/adgroup/get/', {
      advertiser_id: advertiserId,
      fields: JSON.stringify([
        'adgroup_id', 'adgroup_name', 'campaign_id',
        'budget', 'budget_mode', 'status', 'operation_status'
      ])
    });

    // فقط الـ Ad Groups النشطة (غير المتوقفة يدوياً)
    return adgroups.filter(ag =>
      ag.operation_status === 'ENABLE' || ag.secondary_status === 'ADGROUP_STATUS_DELIVERY_OK'
    );
  } catch (err) {
    logger.error(`TikTok adgroups failed for ${advertiserId}`, err);
    return [];
  }
}

// جلب الـ Campaigns النشطة مع أسمائها
async function getActiveCampaigns(advertiserId) {
  try {
    const campaigns = await tiktokGetAllPages('/campaign/get/', {
      advertiser_id: advertiserId,
      fields: JSON.stringify([
        'campaign_id', 'campaign_name', 'status',
        'budget', 'budget_mode', 'operation_status'
      ])
    });

    return campaigns.filter(c =>
      c.operation_status === 'ENABLE' || c.status === 'ENABLE'
    );
  } catch (err) {
    logger.error(`TikTok campaigns failed for ${advertiserId}`, err);
    return [];
  }
}

module.exports = { getActiveAdgroups, getActiveCampaigns };
