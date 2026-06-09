const fmt = {
  currency: (n) => Number(n || 0).toFixed(2),
  percent: (n) => Number(n || 0).toFixed(2),
  int: (n) => Math.round(n || 0).toLocaleString('en'),
  roas: (n) => Number(n || 0).toFixed(2),
  pct: (n) => `${Number(n || 0).toFixed(1)}%`
};

// Escape Markdown special chars in dynamic text (campaign names, adset names, etc.)
// * و _ بيسببوا مشكلة في Telegram Markdown لو مش متطابقين
function escapeMd(str) {
  if (!str) return '';
  return String(str).replace(/[*_`\[\]]/g, '\\$&');
}

// تنسيق رسالة التنبيه الساعي
function formatHourlyAlert(data) {
  const { product, campaign, adset, metrics, alertInfo, cairoTime, accountId } = data;
  const m = metrics;

  const cppDiff = m.costPerPurchase > 0
    ? ((m.costPerPurchase - product.maxCpp) / product.maxCpp * 100).toFixed(0)
    : 0;

  const emoji = alertInfo.reason === 'high_spend_low_purchases' ? '⚠️' : '🚨';
  const platformTag = data.platform === 'tiktok' ? ' — 🎵 TikTok' : ' — 🔵 Meta';
  const header = alertInfo.reason === 'high_spend_low_purchases'
    ? `${emoji} *إنفاق مرتفع — مبيعات منخفضة*${platformTag}`
    : `${emoji} *تجاوز CPP*${platformTag}`;

  // الميزانية اليومية
  const budgetPiastres = parseInt(adset.daily_budget || 0);
  const budgetLine = budgetPiastres > 0
    ? `💼 Daily Budget: *${fmt.currency(budgetPiastres / 100)} ج.م / يوم*`
    : `💼 Daily Budget: CBO (مستوى الحملة)`;

  let text = `${header}\n\n`;
  const adsetLabel = data.platform === 'tiktok' ? 'Ad Group' : 'Ad Set';
  text += `📦 *المنتج:* ${escapeMd(product.name)}\n`;
  text += `🗂 *Campaign:* ${escapeMd(truncate(campaign.name, 40))}\n`;
  text += `📑 *${adsetLabel}:* ${escapeMd(truncate(adset.name, 40))}\n`;
  text += `${budgetLine}\n\n`;

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

function formatPauseConfirmation(adsetName, campaignName) {
  return `✅ *تم إيقاف Ad Set بنجاح*\n\n📑 *${escapeMd(adsetName)} claude edit*\n🗂 ${escapeMd(campaignName)}`;
}

function formatBudgetConfirmation(adsetName, oldBudget, newBudget, pct) {
  return `✅ *تم تقليل الميزانية بنجاح*\n\n📑 ${escapeMd(adsetName)}\n💰 ${fmt.currency(oldBudget)} ج.م ← *${fmt.currency(newBudget)} ج.م* (‎-${pct}%)`;
}

function formatTokenExpiryWarning(daysLeft) {
  return `⚠️ *تحذير: Token Meta قارب على الانتهاء*\n\n` +
    `⏳ متبقي: *${daysLeft} يوم*\n` +
    `👉 جدد من: https://developers.facebook.com/tools/explorer/`;
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

module.exports = {
  fmt, escapeMd, formatHourlyAlert, formatPauseConfirmation,
  formatBudgetConfirmation, formatTokenExpiryWarning, truncate
};
