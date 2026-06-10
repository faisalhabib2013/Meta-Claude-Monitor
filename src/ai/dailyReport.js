const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const db = require('../db');
const { todayString, daysAgoString } = require('../utils/time');
const { fmt } = require('../utils/format');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// توليد التقرير اليومي
async function generateDailyReport() {
  const today = todayString();
  const products = require('../../config/products.json').products;

  // جلب كل البيانات
  const allMetrics = db.getAllAdsetMetricsToday(today);
  const productSummaries = db.getAllProductsToday(today);

  if (allMetrics.length === 0) {
    return 'لا توجد بيانات كافية لليوم.';
  }

  // تجميع البيانات حسب المنتج
  const byProduct = {};
  for (const row of allMetrics) {
    if (!byProduct[row.product_name]) {
      byProduct[row.product_name] = {
        campaigns: {},
        totals: { spend: 0, purchases: 0, impressions: 0, clicks: 0, addToCart: 0 }
      };
    }
    const p = byProduct[row.product_name];
    p.totals.spend += row.spend;
    p.totals.purchases += row.purchases;
    p.totals.impressions += row.impressions;
    p.totals.clicks += row.clicks;
    p.totals.addToCart += row.add_to_cart;

    if (!p.campaigns[row.campaign_id]) {
      p.campaigns[row.campaign_id] = {
        name: row.campaign_name, adsets: []
      };
    }
    p.campaigns[row.campaign_id].adsets.push(row);
  }

  // بناء الـ prompt
  const productData = products.map(product => {
    const data = byProduct[product.name];
    if (!data) return `${product.name}: لا توجد بيانات اليوم`;

    const t = data.totals;
    const totalCpp = t.purchases > 0 ? t.spend / t.purchases : 0;
    const status = totalCpp > product.maxCpp * 1.1 ? '🔴 فوق الحد'
      : totalCpp > product.maxCpp ? '🟡 قريب من الحد'
      : '🟢 ضمن الحد';

    const campaignLines = Object.values(data.campaigns).map(c => {
      const campSpend = c.adsets.reduce((s, a) => s + a.spend, 0);
      const campPurch = c.adsets.reduce((s, a) => s + a.purchases, 0);
      const campCpp = campPurch > 0 ? campSpend / campPurch : 0;
      return `  - ${c.name}: Spend=${fmt.currency(campSpend)}ج.م, Purchases=${campPurch}, CPP=${fmt.currency(campCpp)}ج.م`;
    }).join('\n');

    return [
      `المنتج: ${product.name} (Max CPP: ${product.maxCpp}ج.م) — ${status}`,
      `  إجمالي: Spend=${fmt.currency(t.spend)}ج.م | Purchases=${t.purchases} | CPP=${fmt.currency(totalCpp)}ج.م`,
      `  Impressions=${fmt.int(t.impressions)} | Clicks=${fmt.int(t.clicks)} | ATC=${t.addToCart}`,
      `  الحملات:`,
      campaignLines
    ].join('\n');
  }).join('\n\n');

  // بيانات المقارنة (أمس + نفس اليوم الأسبوع الماضي)
  const yesterday = daysAgoString(1);
  const lastWeek = daysAgoString(7);
  const yesterdaySummary = db.getProductSummaryForDate(yesterday);
  const lastWeekSummary = db.getProductSummaryForDate(lastWeek);

  const makeCompareMap = (arr) => Object.fromEntries(arr.map(p => [p.product_name, p]));
  const yMap = makeCompareMap(yesterdaySummary);
  const lwMap = makeCompareMap(lastWeekSummary);

  // مقارنة Meta vs TikTok لكل منتج
  const platformComparison = {};
  for (const row of db.getAllAdsetMetricsToday(today)) {
    const isTikTok = row.adset_id.startsWith('tt_');
    const platform = isTikTok ? 'tiktok' : 'meta';
    if (!platformComparison[row.product_name]) platformComparison[row.product_name] = { meta: null, tiktok: null };
    const p = platformComparison[row.product_name];
    if (!p[platform]) p[platform] = { spend: 0, purchases: 0 };
    p[platform].spend += row.spend;
    p[platform].purchases += row.purchases;
  }

  const productDataWithComparison = products.map(product => {
    const data = byProduct[product.name];
    if (!data) return null;
    const t = data.totals;
    const cpp = t.purchases > 0 ? t.spend / t.purchases : 0;

    // مقارنة زمنية
    const yData = yMap[product.name];
    const lwData = lwMap[product.name];
    const yCpp = yData?.purchases > 0 ? yData.total_spend / yData.total_purchases : null;
    const lwCpp = lwData?.purchases > 0 ? lwData.total_spend / lwData.total_purchases : null;
    const yCppDiff = yCpp ? ((cpp - yCpp) / yCpp * 100).toFixed(0) : null;
    const lwCppDiff = lwCpp ? ((cpp - lwCpp) / lwCpp * 100).toFixed(0) : null;

    // مقارنة المنصتين
    const platforms = platformComparison[product.name] || {};
    const metaCpp = platforms.meta?.purchases > 0
      ? (platforms.meta.spend / platforms.meta.purchases).toFixed(1) : 'لا توجد مبيعات';
    const tiktokCpp = platforms.tiktok?.purchases > 0
      ? (platforms.tiktok.spend / platforms.tiktok.purchases).toFixed(1) : null;

    const compareLines = [
      yCpp ? `أمس CPP: ${yCpp.toFixed(1)} ج.م (${yCppDiff > 0 ? '+' : ''}${yCppDiff}%)` : 'أمس: لا توجد بيانات',
      lwCpp ? `الأسبوع الماضي CPP: ${lwCpp.toFixed(1)} ج.م (${lwCppDiff > 0 ? '+' : ''}${lwCppDiff}%)` : '',
      tiktokCpp ? `Meta: ${metaCpp} ج.م | TikTok: ${tiktokCpp} ج.م` : `Meta فقط: ${metaCpp} ج.م`
    ].filter(Boolean).join(' | ');

    const status = cpp > product.maxCpp * 1.1 ? 'فوق الحد'
      : cpp <= product.maxCpp * 0.6 ? 'فرصة Scale'
      : cpp <= product.maxCpp ? 'ضمن الحد'
      : 'قريب من الحد';

    return `${product.name} (Max: ${product.maxCpp}ج.م) — ${status}
  اليوم: Spend=${t.spend.toFixed(0)} | Purchases=${t.purchases} | CPP=${cpp.toFixed(1)}ج.م
  مقارنة: ${compareLines}`;
  }).filter(Boolean).join('\n\n');

  const prompt = `أنت محلل إعلانات متخصص في Meta Ads للسوق المصري.
  
البيانات التالية هي أداء الحملات الإعلانية لليوم (${today}) لعلامة تجارية مصرية تبيع منتجات صحية:

${productDataWithComparison}

اكتب تقريراً يومياً موجزاً ومفيداً بالعربي يشمل:
1. ملخص سريع للأداء العام اليوم
2. أبرز المنتجات الجيدة الأداء
3. المنتجات التي تحتاج انتباهاً (فوق الـ Max CPP)
4. ملاحظات مهمة سريعة
5. توصية واحدة أو اثنتين لليوم التالي

الأسلوب: موجز، مباشر، أرقام محددة، قابل للقراءة في 2-3 دقائق.
تذكر: الأرقام بالجنيه المصري والسياق سوق مصري.

قواعد التنسيق (مهمة جداً — Telegram):
- لا تستخدم ## أو ### للعناوين (اكتبها كنص عادي مع إيموجي)
- لا تستخدم جداول بـ | (اكتب كل منتج في سطر)
- لا تستخدم --- كفاصل (استخدم سطراً فارغاً)
- يمكنك استخدام ✅ ❌ 🔴 🟢 🟡 كمؤشرات بصرية
- الحد الأقصى للرد: 1500 كلمة`;

  try {
    const response = await client.messages.create({
      model: config.anthropic.models.light,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text;
  } catch (err) {
    logger.error('Daily report generation failed', err);
    return `فشل توليد التقرير اليومي: ${err.message}`;
  }
}

module.exports = { generateDailyReport };
