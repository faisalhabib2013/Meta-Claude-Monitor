const fmt = {
  currency: (n) => Number(n || 0).toFixed(2),
  percent: (n) => Number(n || 0).toFixed(2),
  int: (n) => Math.round(n || 0).toLocaleString('en'),
  roas: (n) => Number(n || 0).toFixed(2),
  pct: (n) => `${Number(n || 0).toFixed(1)}%`
};

// تنظيف النص من أحرف Markdown الخاصة
// Telegram MarkdownV1 لا يدعم escape sequences — يجب حذف/استبدال الأحرف الخاصة
function escapeMd(str) {
  if (!str) return '';
  return String(str)
    .replace(/\*/g, '')    // * بيسبب bold مفتوح
    .replace(/_/g, '-')    // _ بيسبب italic
    .replace(/`/g, "'")    // backtick بيسبب code
    .replace(/\[/g, '(')  // bracket بيسبب link
    .replace(/\]/g, ')');
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

  if (data.extras) {
    text += `\n📐 *مؤشرات الاتجاه:*\n`;
    if (data.extras.rollingCpp > 0) {
      const trend = m.costPerPurchase > data.extras.rollingCpp * 1.15 ? '📈 أسوأ من المعتاد'
        : m.costPerPurchase < data.extras.rollingCpp * 0.85 ? '📉 أفضل من المعتاد' : '➡️ مستقر';
      text += `• CPP (آخر ${data.extras.rollingDays} أيام): *${fmt.currency(data.extras.rollingCpp)} ج.م* ${trend}\n`;
    }
    if (data.extras.ageDays != null) {
      const ageWarn = data.extras.ageDays >= 21 ? ' ⚠️ _قد يحتاج creative جديد_' : '';
      text += `• ⏳ العمر: ${data.extras.ageDays} يوم${ageWarn}\n`;
    }
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

// تنسيق رسالة فرصة Scale
function formatScaleAlert(data) {
  const { product, campaign, adset, metrics, platform } = data;
  const cppPct = metrics.costPerPurchase > 0
    ? ((metrics.costPerPurchase / product.maxCpp) * 100).toFixed(0)
    : 0;
  const saving = (product.maxCpp - metrics.costPerPurchase).toFixed(2);
  const platformTag = platform === 'tiktok' ? '🎵 TikTok' : '🔵 Meta';
  const adGroupLabel = platform === 'tiktok' ? 'Ad Group' : 'Ad Set';
  const budgetPiastres = parseInt(adset.daily_budget || 0);
  const budgetEGP = platform === 'tiktok'
    ? fmt.currency(budgetPiastres / 100)
    : fmt.currency(budgetPiastres / 100);

  let text = `🚀 *فرصة Scale — ${platformTag}*\n\n`;
  text += `📦 *المنتج:* ${escapeMd(product.name)}\n`;
  text += `🗂 *Campaign:* ${escapeMd(truncate(campaign.name, 40))}\n`;
  text += `📑 *${adGroupLabel}:* ${escapeMd(truncate(adset.name, 40))}\n`;
  text += `💼 Budget الحالية: *${budgetEGP} ج.م / يوم*\n\n`;
  text += `📊 *الأداء:*\n`;
  text += `• 💰 CPP: *${fmt.currency(metrics.costPerPurchase)} ج.م* | Max: ${product.maxCpp} ج.م _(${cppPct}% فقط من الحد ✅)_\n`;
  text += `• 💸 Spend: ${fmt.currency(metrics.spend)} ج.م\n`;
  text += `• 🛒 Purchases: ${metrics.purchases}\n`;
  text += `• 📈 ROAS: ${fmt.roas(metrics.purchaseRoas)}\n`;
  text += `• 💵 توفير عن الحد: ${saving} ج.م لكل مبيعة\n\n`;
  if (data.extras) {
    if (data.extras.rollingCpp > 0) {
      text += `• 📐 CPP (آخر ${data.extras.rollingDays} أيام): ${fmt.currency(data.extras.rollingCpp)} ج.م\n`;
    }
    if (data.extras.ageDays != null) {
      text += `• ⏳ العمر: ${data.extras.ageDays} يوم\n`;
    }
    text += `\n`;
  }
  text += `👆 *رفع الميزانية بنسبة:*`;
  return text;
}

module.exports = {
  fmt, escapeMd, formatHourlyAlert, formatScaleAlert, formatPauseConfirmation,
  formatBudgetConfirmation, formatTokenExpiryWarning, truncate
};
