const { broadcast, sendTo, storeContext } = require('./bot');
const { formatHourlyAlert, formatTokenExpiryWarning } = require('../utils/format');
const { cairoTime } = require('../utils/time');
const config = require('../config');
const logger = require('../utils/logger');

// إرسال تنبيه CPP مع أزرار التحكم
async function sendCppAlert(alertData) {
  const { product, campaign, adset, metrics, alertInfo, accountId, platform } = alertData;

  const text = formatHourlyAlert({
    product, campaign, adset, metrics, alertInfo, accountId,
    cairoTime: cairoTime(), platform: platform || 'meta'
  });

  // تخزين سياق الأزرار
  const ctxKey = storeContext({
    accountId,
    adsetId: adset.id,
    adsetName: adset.name,
    campaignId: campaign.id,
    campaignName: campaign.name,
    productName: product.name,
    platform: platform || 'meta',
    currentBudgetEGP: (parseInt(adset.daily_budget || 0) / 100),
    currentBudgetPiastres: parseInt(adset.daily_budget || 0)
  });

  const keyboard = {
    inline_keyboard: [[
      { text: '⏸ إيقاف Ad Set', callback_data: `pause:${ctxKey}` },
      { text: '💰 تقليل الميزانية', callback_data: `budget_menu:${ctxKey}` }
    ]]
  };

  const results = await broadcast(text, { reply_markup: keyboard });
  logger.alert(`CPP Alert sent for ${product.name} - ${adset.name}`);
  return results;
}

// إرسال التقرير اليومي (نص AI)
async function sendDailyReport(reportText) {
  return broadcast(`📋 *التقرير اليومي*\n\n${reportText}`);
}

// إرسال تحليل يومين متتاليين (نص AI)
async function sendDeepAnalysis(productName, analysisText) {
  const header = `🔬 *تحليل أداء: ${productName}*\n_يومين متتاليين فوق Max CPP_\n\n`;
  return broadcast(header + analysisText);
}

// إرسال تقرير الـ 3 أيام (نص AI)
async function sendTriDayReport(reportText) {
  return broadcast(`📊 *تقرير الـ 3 أيام*\n\n${reportText}`);
}

// تنبيه انتهاء الـ Token
async function sendTokenExpiryWarning(daysLeft) {
  return broadcast(formatTokenExpiryWarning(daysLeft));
}

// رسالة حالة النظام (/status)
async function sendStatusMessage(chatId) {
  const db = require('../db');
  const { todayString, cairoDateTime } = require('../utils/time');
  const products = require('../../config/products.json').products;

  const todayMetrics = db.getAllProductsToday(todayString());

  let text = `🟢 *النظام يعمل بشكل طبيعي*\n`;
  text += `⏰ ${cairoDateTime()} (القاهرة)\n\n`;
  text += `📦 *المنتجات تحت المراقبة: ${products.length}*\n\n`;

  if (todayMetrics.length > 0) {
    text += `📊 *أداء اليوم:*\n`;
    for (const row of todayMetrics) {
      const cpp = row.total_purchases > 0 ? row.total_spend / row.total_purchases : 0;
      const maxCpp = row.max_cpp;
      const status = cpp > maxCpp * 1.1 ? '🔴' : cpp > maxCpp ? '🟡' : '🟢';
      text += `${status} ${row.product_name}: CPP ${cpp.toFixed(0)} ج.م | 🛒 ${Math.round(row.total_purchases)} مبيعة | Spend ${row.total_spend.toFixed(0)} ج.م\n`;
    }
  } else {
    text += `_لا توجد بيانات لليوم حتى الآن_`;
  }

  return sendTo(chatId, text);
}

module.exports = {
  sendCppAlert,
  sendDailyReport,
  sendDeepAnalysis,
  sendTriDayReport,
  sendTokenExpiryWarning,
  sendStatusMessage
};
