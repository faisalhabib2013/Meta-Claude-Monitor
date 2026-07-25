const { tiktokPost, tiktokGet } = require('./client');
const logger = require('../utils/logger');

const BUDGET_FLOOR = 55; // أدنى ميزانية يومية بالجنيه

// جلب بيانات adgroup واحد
async function fetchAdgroup(advertiserId, adgroupId) {
  const data = await tiktokGet('/adgroup/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify([{ field_name: 'adgroup_ids', filter_type: 'IN',
      filter_value: JSON.stringify([adgroupId]) }]),
    fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'budget', 'budget_mode'])
  });
  return data.data?.list?.[0] || null;
}

// تحديث ميزانية adgroup — البنية الصحيحة: adgroup_budgets كقائمة
async function updateAdgroupBudget(advertiserId, adgroupId, newBudget) {
  return tiktokPost('/adgroup/budget/update/', {
    advertiser_id: advertiserId,
    adgroup_budgets: [{ adgroup_id: adgroupId, budget: newBudget }]
  });
}

// إيقاف Ad Group وإضافة "claude edit" للاسم
async function pauseTiktokAdgroup(advertiserId, adgroupId) {
  const adgroup = await fetchAdgroup(advertiserId, adgroupId);
  if (!adgroup) throw new Error(`Adgroup ${adgroupId} not found`);

  const currentName = adgroup.adgroup_name || '';
  const newName = currentName.includes('claude edit')
    ? currentName : `${currentName} claude edit`;

  await tiktokPost('/adgroup/status/update/', {
    advertiser_id: advertiserId,
    adgroup_ids: [adgroupId],
    operation_status: 'DISABLE'
  });

  try {
    await tiktokPost('/adgroup/update/', {
      advertiser_id: advertiserId,
      adgroup_id: adgroupId,
      adgroup_name: newName
    });
  } catch (err) {
    logger.warn(`TikTok rename skipped: ${err.message}`);
  }

  logger.alert(`TikTok adgroup paused: ${newName}`);
  return { success: true, newName, previousName: currentName };
}

// تقليل الميزانية
async function reduceTiktokBudget(advertiserId, adgroupId, percentReduction) {
  const adgroup = await fetchAdgroup(advertiserId, adgroupId);
  if (!adgroup) throw new Error(`Adgroup ${adgroupId} not found`);

  const currentBudget = parseFloat(adgroup.budget || 0);
  if (!currentBudget || adgroup.budget_mode === 'BUDGET_MODE_INFINITE') {
    return { success: false, error: 'الـ Ad Group يستخدم CBO — عدّل الميزانية من الحملة' };
  }

  const reduction = Math.max(0, Math.min(90, percentReduction));
  const newBudget = Math.round(currentBudget * (1 - reduction / 100) * 100) / 100;

  if (newBudget < BUDGET_FLOOR) {
    return {
      success: false,
      error: `الميزانية الجديدة (${newBudget} ج.م) أقل من الحد الأدنى (${BUDGET_FLOOR} ج.م)`
    };
  }

  await updateAdgroupBudget(advertiserId, adgroupId, newBudget);

  logger.success(`TikTok budget: ${currentBudget} → ${newBudget} EGP (-${reduction}%)`);
  return {
    success: true,
    oldBudgetEGP: currentBudget, newBudgetEGP: newBudget,
    percentReduction: reduction, adsetName: adgroup.adgroup_name
  };
}

// رفع ميزانية TikTok Ad Group
async function increaseTiktokBudget(advertiserId, adgroupId, percentIncrease) {
  const adgroup = await fetchAdgroup(advertiserId, adgroupId);
  if (!adgroup) throw new Error(`Adgroup ${adgroupId} not found`);

  const currentBudget = parseFloat(adgroup.budget || 0);
  if (!currentBudget || adgroup.budget_mode === 'BUDGET_MODE_INFINITE') {
    return { success: false, error: 'الـ Ad Group يستخدم CBO — عدّل الميزانية من الحملة' };
  }

  const pct = Math.max(1, Math.min(200, percentIncrease));
  const newBudget = Math.round(currentBudget * (1 + pct / 100) * 100) / 100;

  await updateAdgroupBudget(advertiserId, adgroupId, newBudget);

  logger.success(`TikTok budget increased: ${currentBudget} → ${newBudget} EGP (+${pct}%)`);
  return {
    success: true, oldBudgetEGP: currentBudget, newBudgetEGP: newBudget,
    percentIncrease: pct, adsetName: adgroup.adgroup_name
  };
}

async function getTiktokAdgroupBudget(advertiserId, adgroupId) {
  const ag = await fetchAdgroup(advertiserId, adgroupId) || {};
  return {
    name: ag.adgroup_name,
    dailyBudgetEGP: parseFloat(ag.budget || 0),
    isCBO: ag.budget_mode === 'BUDGET_MODE_INFINITE'
  };
}

module.exports = { pauseTiktokAdgroup, reduceTiktokBudget, increaseTiktokBudget, getTiktokAdgroupBudget };
