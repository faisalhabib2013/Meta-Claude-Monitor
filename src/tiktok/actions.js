const { tiktokPost, tiktokGet } = require('./client');
const logger = require('../utils/logger');

const BUDGET_FLOOR = 55; // أدنى ميزانية يومية بالجنيه (TikTok يستخدم العملة مباشرة)

// إيقاف Ad Group وإضافة "claude edit" للاسم
async function pauseTiktokAdgroup(advertiserId, adgroupId) {
  // جلب الاسم الحالي
  const data = await tiktokGet('/adgroup/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify([{ field_name: 'adgroup_ids', filter_type: 'IN', filter_value: `["${adgroupId}"]` }]),
    fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'status'])
  });

  const adgroup = data.data?.list?.[0];
  if (!adgroup) throw new Error(`Adgroup ${adgroupId} not found`);

  const currentName = adgroup.adgroup_name || '';
  const newName = currentName.includes('claude edit')
    ? currentName
    : `${currentName} claude edit`;

  // إيقاف
  await tiktokPost('/adgroup/status/update/', {
    advertiser_id: advertiserId,
    adgroup_ids: [adgroupId],
    operation_status: 'DISABLE'
  });

  // إعادة تسمية
  try {
    await tiktokPost('/adgroup/update/', {
      advertiser_id: advertiserId,
      adgroup_id: adgroupId,
      adgroup_name: newName
    });
  } catch (renameErr) {
    logger.warn(`TikTok rename failed (adgroup paused): ${renameErr.message}`);
  }

  logger.alert(`TikTok adgroup paused: ${newName}`);
  return { success: true, newName, previousName: currentName };
}

// تقليل الميزانية بنسبة معينة
async function reduceTiktokBudget(advertiserId, adgroupId, percentReduction) {
  const data = await tiktokGet('/adgroup/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify([{ field_name: 'adgroup_ids', filter_type: 'IN', filter_value: `["${adgroupId}"]` }]),
    fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'budget', 'budget_mode'])
  });

  const adgroup = data.data?.list?.[0];
  if (!adgroup) throw new Error(`Adgroup ${adgroupId} not found`);

  const currentBudget = parseFloat(adgroup.budget || 0);
  if (!currentBudget || adgroup.budget_mode === 'BUDGET_MODE_INFINITE') {
    return { success: false, error: 'الـ Ad Group يستخدم Campaign Budget (CBO) ولا يمكن تعديل ميزانيته مباشرة' };
  }

  const reduction = Math.max(0, Math.min(90, percentReduction));
  const newBudget = Math.round(currentBudget * (1 - reduction / 100) * 100) / 100;

  if (newBudget < BUDGET_FLOOR) {
    return {
      success: false,
      error: `الميزانية الجديدة (${newBudget} ج.م) أقل من الحد الأدنى (${BUDGET_FLOOR} ج.م)`,
      minBudget: BUDGET_FLOOR
    };
  }

  await tiktokPost('/adgroup/budget/update/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    budget: newBudget
  });

  logger.success(`TikTok budget reduced: ${currentBudget} → ${newBudget} EGP (-${reduction}%)`);
  return {
    success: true,
    oldBudgetEGP: currentBudget,
    newBudgetEGP: newBudget,
    percentReduction: reduction,
    adsetName: adgroup.adgroup_name
  };
}

// جلب الميزانية الحالية
async function getTiktokAdgroupBudget(advertiserId, adgroupId) {
  const data = await tiktokGet('/adgroup/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify([{ field_name: 'adgroup_ids', filter_type: 'IN', filter_value: `["${adgroupId}"]` }]),
    fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'budget', 'budget_mode'])
  });
  const ag = data.data?.list?.[0] || {};
  return {
    name: ag.adgroup_name,
    dailyBudgetEGP: parseFloat(ag.budget || 0),
    isCBO: ag.budget_mode === 'BUDGET_MODE_INFINITE'
  };
}

module.exports = { pauseTiktokAdgroup, reduceTiktokBudget, getTiktokAdgroupBudget };
