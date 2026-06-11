const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const db = require('../db');
const { getHistoricalInsights } = require('../meta/insights');
const { getLandingPageUrl, getAdCopyText } = require('../meta/creatives');
const { parseInsights } = require('../utils/metrics');
const { todayString, daysAgoString } = require('../utils/time');
const { fmt } = require('../utils/format');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// التحليل العميق لمنتج تجاوز الـ CPP يومين متتاليين
async function generateDeepAnalysis(productName, accountId, campaignIds) {
  const products = require('../../config/products.json').products;
  const product = products.find(p => p.name === productName);
  if (!product) return null;

  logger.info(`Starting deep analysis for: ${productName}`);

  // جلب البيانات التاريخية (3 أشهر)
  const fromDate = daysAgoString(90);
  const toDate = todayString();

  let historicalData = [];
  try {
    historicalData = await getHistoricalInsights(accountId, campaignIds, fromDate, toDate);
  } catch (err) {
    logger.error('Failed to get historical data', err);
  }

  // جلب Landing Page URL
  let landingPageUrl = null;
  try {
    landingPageUrl = await getLandingPageUrl(campaignIds[0]);
  } catch {}

  // جلب Ad Copy
  let adCopies = [];
  try {
    for (const campId of campaignIds.slice(0, 2)) {
      const copies = await getAdCopyText(campId);
      adCopies.push(...copies);
    }
  } catch {}

  // بيانات الـ 2 يوم الأخيرين من الـ DB
  const recentBreaches = db.getRecentBreaches(productName, 2);
  const todayData = db.getDailyMetricsByProduct(productName, daysAgoString(1), toDate);

  // تجميع البيانات التاريخية بشكل منظم
  const weeklyData = aggregateWeekly(historicalData, product);

  // تحليل مؤشرات الـ fatigue من البيانات
  const fatigueSignals = detectFatigueSignals(weeklyData);

  // بناء الـ prompt
  const prompt = buildDeepAnalysisPrompt({
    product,
    recentBreaches,
    weeklyData,
    fatigueSignals,
    landingPageUrl,
    adCopies,
    todayData,
    fromDate
  });

  try {
    const response = await client.messages.create({
      model: config.anthropic.models.heavy,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text;
  } catch (err) {
    logger.error('Deep analysis generation failed', err);
    return `فشل توليد التحليل العميق: ${err.message}`;
  }
}

// تجميع البيانات أسبوعياً
function aggregateWeekly(data, product) {
  const weeks = {};
  for (const row of data) {
    const week = row.date_start;
    if (!weeks[week]) {
      weeks[week] = {
        week,
        spend: 0, purchases: 0,
        impressions: 0, frequency: 0, clicks: 0,
        threeSPlays: 0, thruPlays: 0,
        cpm: 0, ctr: 0, count: 0
      };
    }
    const w = weeks[week];
    const m = parseInsights(row);
    w.spend += m.spend;
    w.purchases += m.purchases;
    w.impressions += m.impressions;
    w.clicks += m.clicks;
    w.threeSPlays += m.threeSPlays;
    w.thruPlays += m.thruPlays;
    w.cpm += m.cpm;
    w.ctr += m.ctr;
    w.frequency += m.frequency;
    w.count++;
  }

  return Object.values(weeks)
    .map(w => ({
      ...w,
      cpp: w.purchases > 0 ? w.spend / w.purchases : 0,
      hookRate: w.impressions > 0 ? (w.threeSPlays / w.impressions) * 100 : 0,
      holdRate: w.threeSPlays > 0 ? (w.thruPlays / w.threeSPlays) * 100 : 0,
      avgCpm: w.count > 0 ? w.cpm / w.count : 0,
      avgCtr: w.count > 0 ? w.ctr / w.count : 0,
      avgFreq: w.count > 0 ? w.frequency / w.count : 0
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

// كشف مؤشرات الـ fatigue
function detectFatigueSignals(weeklyData) {
  if (weeklyData.length < 3) return {};

  const recent = weeklyData.slice(-3);
  const old = weeklyData.slice(0, Math.max(1, weeklyData.length - 3));

  const recentAvgCtr = recent.reduce((s, w) => s + w.avgCtr, 0) / recent.length;
  const oldAvgCtr = old.reduce((s, w) => s + w.avgCtr, 0) / old.length;

  const recentAvgFreq = recent.reduce((s, w) => s + w.avgFreq, 0) / recent.length;
  const oldAvgFreq = old.reduce((s, w) => s + w.avgFreq, 0) / old.length;

  const recentAvgHook = recent.reduce((s, w) => s + w.hookRate, 0) / recent.length;
  const oldAvgHook = old.reduce((s, w) => s + w.hookRate, 0) / old.length;

  const recentAvgCpp = recent.reduce((s, w) => s + w.cpp, 0) / recent.length;
  const oldAvgCpp = old.reduce((s, w) => s + w.cpp, 0) / old.length;

  return {
    ctrDropPct: oldAvgCtr > 0 ? ((recentAvgCtr - oldAvgCtr) / oldAvgCtr) * 100 : 0,
    freqIncreasePct: oldAvgFreq > 0 ? ((recentAvgFreq - oldAvgFreq) / oldAvgFreq) * 100 : 0,
    hookDropPct: oldAvgHook > 0 ? ((recentAvgHook - oldAvgHook) / oldAvgHook) * 100 : 0,
    cppIncreasePct: oldAvgCpp > 0 ? ((recentAvgCpp - oldAvgCpp) / oldAvgCpp) * 100 : 0,
    recentAvgFreq,
    recentAvgCtr,
    recentAvgHook,
    recentAvgCpp
  };
}

// بناء الـ prompt للتحليل العميق
function buildDeepAnalysisPrompt({ product, recentBreaches, weeklyData, fatigueSignals, landingPageUrl, adCopies, todayData }) {
  const weeklyTable = weeklyData.slice(-12).map(w =>
    `${w.week}: CPP=${fmt.currency(w.cpp)}ج.م | Spend=${fmt.currency(w.spend)} | Purch=${w.purchases} | Freq=${fmt.percent(w.avgFreq)} | CTR=${fmt.pct(w.avgCtr)} | Hook=${fmt.pct(w.hookRate)} | Hold=${fmt.pct(w.holdRate)}`
  ).join('\n');

  const adCopySection = adCopies.length > 0
    ? adCopies.map((c, i) =>
      `Ad ${i+1}:\n- Title: ${c.title}\n- Body: ${c.body}\n- CTA: ${c.cta}`
    ).join('\n\n')
    : 'لم يتم جلب نص الإعلان';

  const fatigueSection = `
- انخفاض CTR: ${fmt.percent(fatigueSignals.ctrDropPct || 0)}%
- زيادة Frequency: ${fmt.percent(fatigueSignals.freqIncreasePct || 0)}%
- انخفاض Hook Rate: ${fmt.percent(fatigueSignals.hookDropPct || 0)}%
- زيادة CPP: ${fmt.percent(fatigueSignals.cppIncreasePct || 0)}%
- متوسط Frequency الأخير: ${fmt.percent(fatigueSignals.recentAvgFreq || 0)}
- متوسط Hook Rate الأخير: ${fmt.pct(fatigueSignals.recentAvgHook || 0)}`;

  return `أنت خبير تحليل Meta Ads متخصص في السوق المصري.

المنتج: ${product.name}
Max CPP المسموح: ${product.maxCpp} ج.م
Landing Page: ${landingPageUrl || 'غير متوفر'}

⚠️ السبب: تجاوز CPP اليوم ومن بالأمس الـ Max CPP بأكثر من 10%

━━━━━ بيانات أسبوعية (آخر 3 أشهر) ━━━━━
${weeklyTable || 'لا توجد بيانات تاريخية'}

━━━━━ مؤشرات الـ Fatigue ━━━━━
${fatigueSection}

━━━━━ نص الإعلان (Ad Copy) ━━━━━
${adCopySection}

━━━━━ أداء اليومين الأخيرين ━━━━━
${recentBreaches.map(b => `${b.date}: Spend=${fmt.currency(b.total_spend)}ج.م | Purchases=${b.total_purchases} | CPP=${fmt.currency(b.total_cpp)}ج.م`).join('\n')}

اكتب تحليلاً احترافياً شاملاً يتضمن:

**1. تشخيص المشكلة الرئيسية**
ما هو السبب الأرجح لارتفاع CPP؟

**2. Creative Fatigue**
هل هناك علامات على إرهاق الإعلانات؟ (Hook Rate، Hold Rate، CTR، Frequency)

**3. Audience Fatigue / Saturation**
هل يبدو أن الجمهور أصبح مشبعاً؟

**4. تحليل Ad Copy**
ملاحظاتك على نص الإعلان وهل يحتاج تحسين؟

**5. تحليل Landing Page**
هل هناك احتمال مشكلة في الـ Landing Page؟

**6. Product Decline / Market Saturation**
هل البيانات تشير إلى تشبع في السوق؟

**7. تحليلات إضافية**
أي ملاحظات أخرى تراها مهمة.

**8. خطة الحل (الأولويات)**
قائمة بالإجراءات المقترحة بالترتيب حسب الأهمية.

التنسيق: عربي واضح، مباشر، قابل للتطبيق.

تعليمات التنسيق — إلزامية تماماً (هذا النظام يرسل عبر Telegram):
❌ ممنوع منعاً باتاً: ##, ###, **text**, ----, |جداول|
✅ مسموح فقط: نص عادي + إيموجي كعناوين + * للتقسيم
مثال صحيح:
"🎯 ملخص الأداء
إجمالي الإنفاق: 78,360 ج.م
إجمالي المشتريات: 1,225
متوسط CPP: 63.9 ج.م"
مثال خاطئ (لا تفعل هذا):
"## 🎯 ملخص الأداء
| المنتج | CPP |
|--------|-----|"
قواعد Telegram:
- لا ## أو ### — استخدم رقم + إيموجي + عنوان
- لا جداول
- لا --- فواصل
- الحد الأقصى: 1500 كلمة`;
}

module.exports = { generateDeepAnalysis };
