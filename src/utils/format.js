// تنسيق الأرقام
const fmt = {
  currency: (n) => Number(n || 0).toFixed(2),
  percent: (n) => Number(n || 0).toFixed(2),
  int: (n) => Math.round(n || 0).toLocaleString('en'),
  roas: (n) => Number(n || 0).toFixed(2),
  pct: (n) => `${Number(n || 0).toFixed(1)}%`
};

// تنسيق رسالة التنبيه الساعي (بدون توصيات - أرقام فقط)
function formatHourlyAlert(data) {
  const { product, campaign, adset, metrics, alertInfo, cairoTime, accountId } = data;
  const m = metrics;

  const cppDiff = ((m.costPerPurchase - product.maxCpp) / product.maxCpp * 100).toFixed(0);
  const emoji = alertInfo.reason === 'high_spend_low_purchases' ? '⚠️' : '🚨';

  const header = alertInfo.reason === 'high_spend_low_purchases'
    ? `${emoji} *إنفاق مرتفع — مبيعات منخفضة*`
    : `${emoji} *تجاوز CPP*`;

  let text = `${header}\n\n`;
  text += `📦 *المنتج:* ${product.name}\n`;
  text += `🗂 *Campaign:* ${truncate(campaign.name, 40)}\n`;
  text += `📑 *Ad Set:* ${truncate(adset.name, 40)}\n`;
  text += `🏦 *Account:* act\\_${accountId}\n\n`;

  text += `📊 *الأرقام اليوم:*\n`;

  if (alertInfo.reason === 'high_spend_low_purchases') {
    text += `• 💸 Amount Spent: *${fmt.currency(m.spend)} ج.م* (${((m.spend / product.maxCpp) * 100).toFixed(0)}% من Max CPP)\n`;
    text += `• 🛒 Purchases: *${m.purchases}* فقط\n`;
  } else {
    text += `• 💰 Cost per Purchase: *${fmt.currency(m.costPerPurchase)} ج.م* | Max: ${product.maxCpp} ج.م (+${cppDiff}%)\n`;
    text += `• 💸 Amount Spent: *${fmt.currency(m.spend)} ج.م*\n`;
    text += `• 🛒 Purchases: *${m.purchases}*\n`;
  }

  text += `• 📈 Purchase ROAS: ${fmt.roas(m.purchaseRoas)}\n`;
  text += `• 👁 Impressions: ${fmt.int(m.impressions)}\n`;
  text += `• 🔁 Frequency: ${fmt.percent(m.frequency)}\n`;
  text += `• 🖱 CTR: ${fmt.pct(m.ctr)}\n`;
  text += `• 💵 CPM: ${fmt.currency(m.cpm)} ج.م\n`;
  text += `• 🔗 CPC: ${fmt.currency(m.cpc)} ج.م\n`;
  text += `• 👆 Link Clicks: ${fmt.int(m.clicks)}\n`;
  text += `• 🌐 LP Views: ${fmt.int(m.lpViews)}\n`;
  text += `• 📊 LP View Rate: ${fmt.pct(m.lpViewRate)}\n`;
  text += `• 🎯 Purchases Rate (LP): ${fmt.pct(m.purchaseRateLP)}\n`;
  text += `• 💎 Conv. Value: ${fmt.currency(m.purchaseValue)} ج.م\n`;
  text += `• 🛍 Adds to Cart: ${fmt.int(m.addToCart)}\n`;
  text += `• 🏷 Cost/ATC: ${fmt.currency(m.costPerATC)} ج.م\n`;
  text += `• ✅ Checkouts: ${fmt.int(m.checkouts)}\n`;

  if (m.threeSPlays > 0 || m.thruPlays > 0) {
    text += `• 🎬 3s Video Plays: ${fmt.int(m.threeSPlays)}\n`;
    text += `• ▶️ ThruPlays: ${fmt.int(m.thruPlays)}\n`;
    text += `• 🪝 Hook Rate: ${fmt.pct(m.hookRate)}\n`;
    text += `• 🔒 Hold Rate: ${fmt.pct(m.holdRate)}\n`;
    text += `• 📲 CTA Rate: ${fmt.pct(m.ctaRate)}\n`;
  }

  text += `\n⏰ *${cairoTime}* بتوقيت القاهرة`;

  return text;
}

// تنسيق التقرير اليومي (AI Generated)
function formatDailyReportHeader(date) {
  return `📋 *التقرير اليومي — ${date}*\n`;
}

// تنسيق تقرير الـ 3 أيام header
function formatTriDayReportHeader(fromDate, toDate) {
  return `📊 *تقرير الـ 3 أيام — ${fromDate} إلى ${toDate}*\n`;
}

// تنسيق رسالة تأكيد الإيقاف
function formatPauseConfirmation(adsetName, campaignName) {
  return `✅ *تم إيقاف Ad Set بنجاح*\n\n📑 *${adsetName} claude edit*\n🗂 ${campaignName}`;
}

// تنسيق رسالة تأكيد تقليل الميزانية
function formatBudgetConfirmation(adsetName, oldBudget, newBudget, pct) {
  return `✅ *تم تقليل الميزانية بنجاح*\n\n📑 ${adsetName}\n💰 ${fmt.currency(oldBudget)} ج.م ← *${fmt.currency(newBudget)} ج.م* (‎-${pct}%)`;
}

// تقطيع النص الطويل
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// تنسيق رسالة انتهاء الـ Token
function formatTokenExpiryWarning(daysLeft) {
  return `⚠️ *تحذير: Token Meta قارب على الانتهاء*\n\n` +
    `⏳ متبقي: *${daysLeft} يوم*\n` +
    `👉 يجب تجديده من هنا: https://developers.facebook.com/tools/explorer/`;
}

module.exports = {
  fmt,
  formatHourlyAlert,
  formatDailyReportHeader,
  formatTriDayReportHeader,
  formatPauseConfirmation,
  formatBudgetConfirmation,
  formatTokenExpiryWarning,
  truncate
};
