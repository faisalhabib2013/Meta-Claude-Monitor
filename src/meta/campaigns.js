const { metaGetAll } = require('./client');
const logger = require('../utils/logger');

// جلب كل الـ AdSets الفعالة لحساب معين مع بيانات الميزانية
async function getActiveAdsets(accountId) {
  try {
    const adsets = await metaGetAll(`/act_${accountId}/adsets`, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id',
      filtering: JSON.stringify([
        { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }
      ]),
      limit: 200
    });

    // فلترة الـ adsets المتوقفة يدوياً (status = PAUSED)
    return adsets.filter(a => a.status === 'ACTIVE');
  } catch (err) {
    logger.error(`Failed to get adsets for account ${accountId}`, err);
    return [];
  }
}

// جلب كل الـ Campaigns الفعالة لحساب معين
async function getActiveCampaigns(accountId) {
  try {
    const campaigns = await metaGetAll(`/act_${accountId}/campaigns`, {
      fields: 'id,name,status,effective_status,objective',
      filtering: JSON.stringify([
        { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }
      ]),
      limit: 200
    });

    return campaigns.filter(c => c.status === 'ACTIVE');
  } catch (err) {
    logger.error(`Failed to get campaigns for account ${accountId}`, err);
    return [];
  }
}

// جلب بيانات حملة واحدة (للـ daily report)
async function getCampaignDetails(campaignId) {
  try {
    const { metaGet } = require('./client');
    return await metaGet(`/${campaignId}`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget'
    });
  } catch (err) {
    logger.error(`Failed to get campaign ${campaignId}`, err);
    return null;
  }
}

module.exports = { getActiveAdsets, getActiveCampaigns, getCampaignDetails };
