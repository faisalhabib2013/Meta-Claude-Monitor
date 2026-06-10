// استخراج قيمة action معين من مصفوفة actions
function getActionValue(actions, actionType) {
  if (!actions || !Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === actionType);
  return action ? parseFloat(action.value) || 0 : 0;
}

// استخراج قيمة cost_per_action_type
function getCostPerAction(costPerAction, actionType) {
  if (!costPerAction || !Array.isArray(costPerAction)) return 0;
  const item = costPerAction.find(a => a.action_type === actionType);
  return item ? parseFloat(item.value) || 0 : 0;
}

// استخراج قيمة action_values (قيمة الشراء)
function getActionValueAmount(actionValues, actionType) {
  if (!actionValues || !Array.isArray(actionValues)) return 0;
  const item = actionValues.find(a => a.action_type === actionType);
  return item ? parseFloat(item.value) || 0 : 0;
}

// استخراج video action
function getVideoActionValue(videoActions) {
  if (!videoActions || !Array.isArray(videoActions)) return 0;
  const item = videoActions.find(a => a.action_type === 'video_view');
  return item ? parseFloat(item.value) || 0 : 0;
}

// حساب كل الـ metrics من الـ insights
function parseInsights(data) {
  const spend = parseFloat(data.spend || 0);
  const impressions = parseInt(data.impressions || 0);
  const frequency = parseFloat(data.frequency || 0);
  const reach = parseInt(data.reach || 0);
  const clicks = parseInt(data.clicks || 0);
  const ctr = parseFloat(data.ctr || 0);
  const cpm = parseFloat(data.cpm || 0);
  const cpc = parseFloat(data.cpc || 0);

  const purchases = getActionValue(data.actions, 'purchase');
  const addToCart = getActionValue(data.actions, 'add_to_cart');
  const checkouts = getActionValue(data.actions, 'initiate_checkout');
  const lpViews = getActionValue(data.actions, 'landing_page_view');
  const results = purchases; // primary KPI for e-commerce

  const costPerPurchase = purchases > 0 ? spend / purchases : 0;
  const costPerATC = getCostPerAction(data.cost_per_action_type, 'add_to_cart');
  const costPerLPView = getCostPerAction(data.cost_per_action_type, 'landing_page_view');
  const purchaseValue = getActionValueAmount(data.action_values, 'purchase');

  const purchaseRoas = spend > 0 && purchaseValue > 0 ? purchaseValue / spend : 0;

  // video_view في actions = مشاهدات 3 ثواني (بديل video_p3_watched_actions المُهمَل في v20+)
  const threeSPlays = getActionValue(data.actions, 'video_view');
  // ThruPlays: من الـ field المخصص أو من actions كـ fallback
  const thruPlays = getVideoActionValue(data.video_thruplay_watched_actions) ||
    getActionValue(data.actions, 'video_thruplay_watched_action');

  // نسب الفيديو المشتقة
  const hookRate = impressions > 0 ? (threeSPlays / impressions) * 100 : 0;
  const holdRate = threeSPlays > 0 ? (thruPlays / threeSPlays) * 100 : 0;
  const ctaRate = thruPlays > 0 ? (clicks / thruPlays) * 100 : 0;

  // نسبة المشتريات من LP Views
  const purchaseRateLP = lpViews > 0 ? (purchases / lpViews) * 100 : 0;
  // نسبة LP Views من الكليكات
  const lpViewRate = clicks > 0 ? (lpViews / clicks) * 100 : 0;
  // 3s Video Rate per impressions
  const threeSRate = impressions > 0 ? (threeSPlays / impressions) * 100 : 0;

  return {
    spend,
    impressions,
    frequency,
    reach,
    clicks,
    ctr,
    cpm,
    cpc,
    purchases,
    addToCart,
    checkouts,
    lpViews,
    results,
    costPerPurchase,
    costPerATC,
    costPerLPView,
    purchaseValue,
    purchaseRoas,
    threeSPlays,
    thruPlays,
    hookRate,
    holdRate,
    ctaRate,
    purchaseRateLP,
    lpViewRate,
    threeSRate
  };
}

// هل يجب إرسال تنبيه؟
function shouldAlert(metrics, product, config) {
  const { purchases, spend, costPerPurchase } = metrics;
  const { maxCpp } = product;
  const { cppBuffer, minPurchases, highSpendMultiplier } = config.monitor;

  // حالة 1: مشتريات كافية وتجاوز الـ threshold
  if (purchases >= minPurchases && costPerPurchase > maxCpp * cppBuffer) {
    return {
      trigger: true,
      reason: 'high_cpp',
      cpp: costPerPurchase,
      threshold: maxCpp * cppBuffer
    };
  }

  // حالة 2: إنفاق عالي مع مبيعات منخفضة (0 أو 1)
  if (purchases < minPurchases && spend > maxCpp * highSpendMultiplier) {
    return {
      trigger: true,
      reason: 'high_spend_low_purchases',
      cpp: purchases > 0 ? costPerPurchase : Infinity,
      threshold: maxCpp * highSpendMultiplier
    };
  }

  return { trigger: false };
}

module.exports = {
  getActionValue,
  getCostPerAction,
  getActionValueAmount,
  getVideoActionValue,
  parseInsights,
  shouldAlert
};
