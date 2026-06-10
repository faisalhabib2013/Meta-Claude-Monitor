const { metaPost, metaGet } = require('./client');
const logger = require('../utils/logger');

const BUDGET_FLOOR_PIASTRES = 5500; // 55 ج.م

// إيقاف Ad Set وإضافة "claude edit" للاسم
async function pauseAdset(adsetId) {
  // جلب الاسم الحالي أولاً
  const adsetData = await metaGet(`/${adsetId}`, { fields: 'name,status,daily_budget' });
  const currentName = adsetData.name || '';

  // منع الإضافة المكررة
  const newName = currentName.includes('claude edit')
    ? currentName
    : `${currentName} claude edit`;

  // إيقاف وإعادة التسمية في نفس الطلب
  await metaPost(`/${adsetId}`, {
    status: 'PAUSED',
    name: newName
  });

  logger.alert(`Paused adset: ${newName} (${adsetId})`);
  return { success: true, newName, previousName: currentName };
}

// تقليل الميزانية بنسبة معينة
async function reduceBudget(adsetId, percentReduction) {
  // جلب الميزانية الحالية
  const adsetData = await metaGet(`/${adsetId}`, {
    fields: 'name,daily_budget,lifetime_budget'
  });

  const currentBudgetPiastres = parseInt(adsetData.daily_budget || 0);

  if (!currentBudgetPiastres) {
    return {
      success: false,
      error: 'لا يوجد daily budget لهذا الـ Ad Set (قد يستخدم Campaign Budget Optimization)'
    };
  }

  const reduction = Math.max(0, Math.min(90, percentReduction)); // 0% - 90% max
  const newBudgetPiastres = Math.round(currentBudgetPiastres * (1 - reduction / 100));

  // التحقق من الحد الأدنى
  if (newBudgetPiastres < BUDGET_FLOOR_PIASTRES) {
    return {
      success: false,
      error: `الميزانية الجديدة (${(newBudgetPiastres / 100).toFixed(2)} ج.م) أقل من الحد الأدنى المسموح (55 ج.م)`,
      minBudget: BUDGET_FLOOR_PIASTRES / 100
    };
  }

  await metaPost(`/${adsetId}`, { daily_budget: newBudgetPiastres });

  const oldBudgetEGP = currentBudgetPiastres / 100;
  const newBudgetEGP = newBudgetPiastres / 100;

  logger.success(`Budget reduced for ${adsetId}: ${oldBudgetEGP} → ${newBudgetEGP} EGP (-${reduction}%)`);

  return {
    success: true,
    oldBudgetEGP,
    newBudgetEGP,
    percentReduction: reduction,
    adsetName: adsetData.name
  };
}

// جلب الميزانية الحالية لـ adset
async function getAdsetBudget(adsetId) {
  const data = await metaGet(`/${adsetId}`, {
    fields: 'name,daily_budget,lifetime_budget,status'
  });
  return {
    name: data.name,
    dailyBudgetEGP: parseInt(data.daily_budget || 0) / 100,
    dailyBudgetPiastres: parseInt(data.daily_budget || 0),
    hasLifetimeBudget: !!data.lifetime_budget,
    status: data.status
  };
}

module.exports = { pauseAdset, reduceBudget, getAdsetBudget };
