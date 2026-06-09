const { metaGetAll } = require('./client');
const logger = require('../utils/logger');

// جلب الـ Ads داخل Adset معين
async function getAdsInAdset(adsetId) {
  try {
    return await metaGetAll(`/${adsetId}/ads`, {
      fields: 'id,name,status,effective_status',
      filtering: JSON.stringify([
        { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }
      ]),
      limit: 50
    });
  } catch (err) {
    logger.error(`Failed to get ads in adset ${adsetId}`, err);
    return [];
  }
}

// جلب الـ Creative وURL الـ Landing Page لإعلان معين
async function getAdCreative(adId) {
  try {
    const { metaGet } = require('./client');
    const adData = await metaGet(`/${adId}`, {
      fields: 'creative{id,body,title,description,object_url,link_url,image_url,call_to_action}'
    });
    return adData.creative || null;
  } catch (err) {
    logger.error(`Failed to get creative for ad ${adId}`, err);
    return null;
  }
}

// جلب أول Landing Page URL لـ Campaign معينة
async function getLandingPageUrl(campaignId) {
  try {
    // جلب أول adset
    const adsets = await metaGetAll(`/${campaignId}/adsets`, {
      fields: 'id',
      limit: 1
    });

    if (!adsets.length) return null;

    // جلب أول ad
    const ads = await getAdsInAdset(adsets[0].id);
    if (!ads.length) return null;

    // جلب الـ creative
    const creative = await getAdCreative(ads[0].id);
    if (!creative) return null;

    return creative.object_url || creative.link_url || null;
  } catch (err) {
    logger.error(`Failed to get landing page for campaign ${campaignId}`, err);
    return null;
  }
}

// جلب نص الـ Ad Copy لحملة معينة
async function getAdCopyText(campaignId) {
  try {
    const adsets = await metaGetAll(`/${campaignId}/adsets`, {
      fields: 'id', limit: 2
    });

    const copies = [];
    for (const adset of adsets.slice(0, 2)) {
      const ads = await getAdsInAdset(adset.id);
      for (const ad of ads.slice(0, 2)) {
        const creative = await getAdCreative(ad.id);
        if (creative) {
          copies.push({
            title: creative.title || '',
            body: creative.body || '',
            description: creative.description || '',
            cta: creative.call_to_action?.type || ''
          });
        }
      }
    }

    return copies;
  } catch (err) {
    logger.error(`Failed to get ad copy for campaign ${campaignId}`, err);
    return [];
  }
}

module.exports = { getLandingPageUrl, getAdCopyText, getAdsInAdset };
