const { broadcast, broadcastLong, sendTo, storeContext } = require('./bot');
const { formatHourlyAlert, formatScaleAlert, formatTokenExpiryWarning, fmt, escapeMd, truncate } = require('../utils/format');
const { cairoTime } = require('../utils/time');
const config = require('../config');
const logger = require('../utils/logger');

// إرسال تنبيه CPP مع أزرار التحكم
async function sendCppAlert(alertData) {
  const { product, campaign, adset, metrics, alertInfo, accountId, platform, extras } = alertData;

  const text = formatHourlyAlert({
    product, campaign, adset, metrics, alertInfo, accountId,
    cairoTime: cairoTime(), platform: platform || 'meta', extras
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
  const anySuccess = results.some(r => r.success);
  if (anySuccess) {
    logger.alert(`CPP Alert sent for ${product.name} - ${adset.name}`);
  } else {
    logger.error(`CPP Alert FAILED for ${product.name} - ${adset.name} (all chats rejected)`);
  }
  return results;
}

// إرسال التقرير اليومي (نص AI)
async function sendDailyReport(reportText) {
  return broadcastLong(`📋 التقرير اليومي\n\n${reportText}`, {}, true);
}

// إرسال تحليل يومين متتاليين (نص AI)
async function sendDeepAnalysis(productName, analysisText) {
  const header = `🔬 تحليل أداء: ${productName}\nيومين متتاليين فوق Max CPP\n\n`;
  return broadcastLong(header + analysisText, {}, true);
}

// إرسال تقرير الـ 3 أيام (نص AI)
async function sendTriDayReport(reportText) {
  return broadcastLong(`📊 تقرير الـ 3 أيام\n\n${reportText}`, {}, true);
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

// إرسال تنبيه فرصة Scale مع أزرار رفع الميزانية
async function sendScaleAlert(alertData) {
  const { product, campaign, adset, metrics, accountId, platform, extras } = alertData;
  const text = formatScaleAlert({ product, campaign, adset, metrics, platform, extras });

  const ctxKey = storeContext({
    accountId, adsetId: adset.id, adsetName: adset.name,
    campaignId: campaign.id, campaignName: campaign.name,
    productName: product.name, platform: platform || 'meta',
    currentBudgetEGP: parseInt(adset.daily_budget || 0) / 100,
    currentBudgetPiastres: parseInt(adset.daily_budget || 0)
  });

  const keyboard = {
    inline_keyboard: [
      [
        { text: '+20%', callback_data: `scale_up:${ctxKey}:20` },
        { text: '+40%', callback_data: `scale_up:${ctxKey}:40` },
        { text: '+60%', callback_data: `scale_up:${ctxKey}:60` }
      ],
      [
        { text: '+80%', callback_data: `scale_up:${ctxKey}:80` },
        { text: '+100%', callback_data: `scale_up:${ctxKey}:100` },
        { text: '❌ تجاهل', callback_data: 'cancel' }
      ]
    ]
  };

  const results = await broadcast(text, { reply_markup: keyboard });
  const anySuccess = results.some(r => r.success);
  if (anySuccess) logger.success(`Scale Alert sent for ${product.name} - ${adset.name}`);
  return results;
}

// /budget — إجمالي الإنفاق اليوم + توقع نهاية اليوم
async function sendBudgetReport(chatId) {
  const db = require('../db');
  const { todayString, nowCairo } = require('../utils/time');

  const today = todayString();
  const allMetrics = db.getAllAdsetMetricsToday(today);
  const products = require('../../config/products.json').products;

  let totalSpend = 0;
  const byProduct = {};
  allMetrics.forEach(row => {
    totalSpend += row.spend;
    if (!byProduct[row.product_name]) byProduct[row.product_name] = 0;
    byProduct[row.product_name] += row.spend;
  });

  // توقع الإنفاق بنهاية اليوم
  const now = nowCairo();
  const minutesElapsed = now.getHours() * 60 + now.getMinutes();
  const pctOfDay = minutesElapsed / (24 * 60);
  const projectedTotal = pctOfDay > 0.05 ? totalSpend / pctOfDay : null;

  let text = `💸 *ميزانية اليوم*\n⏰ ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')} القاهرة\n\n`;
  text += `💰 *إجمالي الإنفاق حتى الآن:* ${fmt.currency(totalSpend)} ج.م\n`;
  if (projectedTotal) {
    text += `📈 *المتوقع بنهاية اليوم:* ${fmt.currency(projectedTotal)} ج.م\n`;
  }
  text += `\n📦 *تفصيل بالمنتجات:*\n`;

  Object.entries(byProduct)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, spend]) => {
      text += `• ${name}: ${fmt.currency(spend)} ج.م\n`;
    });

  return sendTo(chatId, text);
}

// /top — أفضل 3 منتجات أداءً اليوم
async function sendTopProducts(chatId) {
  const db = require('../db');
  const { todayString } = require('../utils/time');
  const products = require('../../config/products.json').products;
  const today = todayString();

  const summaries = db.getAllProductsToday(today)
    .filter(p => p.total_purchases > 0)
    .map(p => {
      const product = products.find(pr => pr.name === p.product_name);
      const cpp = p.total_spend / p.total_purchases;
      const maxCpp = product?.maxCpp || 999;
      const ratio = cpp / maxCpp;
      return { ...p, cpp, maxCpp, ratio };
    })
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 3);

  if (!summaries.length) return sendTo(chatId, '📊 لا توجد بيانات مبيعات اليوم حتى الآن.');

  let text = `🏆 *أفضل 3 منتجات اليوم*\n\n`;
  summaries.forEach((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i];
    const pct = (p.ratio * 100).toFixed(0);
    text += `${medal} *${p.product_name}*\n`;
    text += `   CPP: ${fmt.currency(p.cpp)} ج.م (${pct}% من Max ${p.maxCpp})\n`;
    text += `   Spend: ${fmt.currency(p.total_spend)} ج.م | Purchases: ${Math.round(p.total_purchases)}\n\n`;
  });

  return sendTo(chatId, text);
}

// /product [name] — أداء المنتج per adset خلال آخر N يوم
async function sendProductReport(chatId, productQuery, days = 3) {
  const db = require('../db');
  const { todayString, daysAgoString } = require('../utils/time');
  const products = require('../../config/products.json').products;

  // إيجاد المنتج المطابق
  const match = products.find(p =>
    p.name.includes(productQuery) || productQuery.includes(p.name)
  );
  const productName = match ? match.name : productQuery;
  const maxCpp = match?.maxCpp || 0;

  const today = todayString();
  const fromDate = daysAgoString(days - 1);
  const rows = db.getDailyMetricsByProduct(productName, fromDate, today);

  if (!rows.length) {
    return sendTo(chatId,
      `❌ لا توجد بيانات لـ *${escapeMd(productName)}* خلال آخر ${days} أيام\n\n` +
      `💡 تأكد من الاسم. المنتجات المتاحة:\n` +
      products.map(p => `• ${p.name}`).join('\n')
    );
  }

  // حساب الإجمالي
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalPurch = rows.reduce((s, r) => s + r.purchases, 0);
  const totalCpp = totalPurch > 0 ? totalSpend / totalPurch : 0;
  const cppStatus = totalCpp > maxCpp * 1.1 ? '🔴' : totalCpp > maxCpp ? '🟡' : '🟢';

  let text = `📦 *${escapeMd(productName)}* — آخر ${days} أيام\n`;
  text += `💰 Max CPP: ${maxCpp} ج.م\n\n`;
  text += `📊 *الإجمالي:*\n`;
  text += `• Spend: ${fmt.currency(totalSpend)} ج.م | Purchases: ${Math.round(totalPurch)}\n`;
  text += `• CPP: ${cppStatus} *${fmt.currency(totalCpp)} ج.م*\n\n`;

  // تجميع حسب التاريخ
  const byDate = {};
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });

  const sortedDates = Object.keys(byDate).sort().reverse();
  for (const date of sortedDates) {
    const dayRows = byDate[date].sort((a, b) => b.spend - a.spend);
    const daySpend = dayRows.reduce((s, r) => s + r.spend, 0);
    const dayPurch = dayRows.reduce((s, r) => s + r.purchases, 0);
    const dayCpp = dayPurch > 0 ? daySpend / dayPurch : 0;
    const dayStatus = dayCpp > maxCpp * 1.1 ? '🔴' : dayCpp > maxCpp ? '🟡' : '🟢';

    text += `📅 *${date}* ${dayStatus} — Spend: ${fmt.currency(daySpend)} | Purch: ${Math.round(dayPurch)} | CPP: ${fmt.currency(dayCpp)}\n`;

    for (const row of dayRows) {
      if (row.spend < 1) continue; // تجاهل الإنفاق الصفري
      const plt = row.adset_id.startsWith('tt_') ? '🎵' : '🔵';
      const ind = row.cpp > maxCpp * 1.1 ? '🔴' : row.cpp > maxCpp ? '🟡' : '🟢';
      const name = escapeMd(truncate(row.adset_name, 28));
      text += `  ${plt}${ind} ${name}: *${fmt.currency(row.cpp)}ج.م* | ${fmt.currency(row.spend)} | ${Math.round(row.purchases)}\n`;
    }
    text += '\n';
  }

  return sendTo(chatId, text.trim());
}

// /worst — أسوأ 3 منتجات أداءً اليوم
async function sendWorstProducts(chatId) {
  const db = require('../db');
  const { todayString } = require('../utils/time');
  const products = require('../../config/products.json').products;
  const today = todayString();

  const summaries = db.getAllProductsToday(today)
    .filter(p => p.total_spend > 0)
    .map(p => {
      const product = products.find(pr => pr.name === p.product_name);
      const cpp = p.total_purchases > 0 ? p.total_spend / p.total_purchases : 0;
      const maxCpp = product?.maxCpp || 999;
      const ratio = cpp > 0 ? cpp / maxCpp : 0;
      return { ...p, cpp, maxCpp, ratio };
    })
    .filter(p => p.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);

  if (!summaries.length) return sendTo(chatId, '📊 لا توجد بيانات كافية اليوم حتى الآن.');

  let text = `⬇️ *أسوأ 3 منتجات اليوم*\n\n`;
  const medals = ['🥇', '🥈', '🥉'];
  summaries.forEach((p, i) => {
    const pct = (p.ratio * 100).toFixed(0);
    const ind = p.ratio > 1.1 ? '🔴' : p.ratio > 1 ? '🟡' : '🟠';
    text += `${medals[i]}${ind} *${p.product_name}*\n`;
    text += `   CPP: ${fmt.currency(p.cpp)} ج.م (${pct}% من Max ${p.maxCpp})\n`;
    text += `   Spend: ${fmt.currency(p.total_spend)} ج.م | Purchases: ${Math.round(p.total_purchases)}\n\n`;
  });

  return sendTo(chatId, text.trim());
}

module.exports = {
  sendCppAlert, sendScaleAlert, sendDailyReport,
  sendDeepAnalysis, sendTriDayReport, sendTokenExpiryWarning,
  sendStatusMessage, sendBudgetReport, sendTopProducts,
  sendProductReport, sendWorstProducts
};
