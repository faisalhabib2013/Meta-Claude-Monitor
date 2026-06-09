const { tiktokGetAllPages } = require('./client');
const logger = require('../utils/logger');

// الـ fields الصحيحة المضمونة في TikTok API v1.3
// (status و operation_status غير صالحين كـ fields للـ GET)
const CAMPAIGN_FIELDS = ['campaign_id', 'campaign_name', 'budget', 'budget_mode'];
const ADGROUP_FIELDS  = ['adgroup_id', 'adgroup_name', 'campaign_id', 'budget', 'budget_mode'];

// جلب كل الـ Campaigns
async function getActiveCampaigns(advertiserId) {
  try {
    return await tiktokGetAllPages('/campaign/get/', {
      advertiser_id: advertiserId,
      fields: JSON.stringify(CAMPAIGN_FIELDS),
      page_size: 100
    });
  } catch (err) {
    logger.error(`TikTok campaigns failed for ${advertiserId}`, err);
    return [];
  }
}

// جلب كل الـ Ad Groups
async function getActiveAdgroups(advertiserId) {
  try {
    return await tiktokGetAllPages('/adgroup/get/', {
      advertiser_id: advertiserId,
      fields: JSON.stringify(ADGROUP_FIELDS),
      page_size: 100
    });
  } catch (err) {
    logger.error(`TikTok adgroups failed for ${advertiserId}`, err);
    return [];
  }
}

module.exports = { getActiveAdgroups, getActiveCampaigns };
