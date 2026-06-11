const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const db = require('../db');
const { todayString, daysAgoString } = require('../utils/time');
const { fmt } = require('../utils/format');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// توليد تقرير الـ 3 أيام الاستراتيجي
async function generateTriDayReport() {
  const products = require('../../config/products.json').products;
  const today = todayString();
  const threeDaysAgo = daysAgoString(3);

  // جلب بيانات الـ 3 أيام
  const allData = {};
  for (const product of products) {
    const rows = db.getDailyMetricsByProduct(product.name, threeDaysAgo, today);
    if (rows.length > 0) {
      allData[product.name] = {
        product,
        rows,
        totals: aggregateDays(rows)
      };
    }
  }

  if (Object.keys(allData).length === 0) {
    return 'لا توجد بيانات كافية للفترة الأخيرة.';
  }

  const dataSection = Object.values(allData).map(({ product, totals }) => {
    const cpp = totals.purchases > 0 ? totals.spend / totals.purchases : 0;
    const roas = totals.spend > 0 && totals.purchaseValue > 0 ? totals.purchaseValue / totals.spend : 0;
    const status = cpp < product.maxCpp * 0.8 ? '🟢 ممتاز (فرصة scale)'
      : cpp <= product.maxCpp ? '🟡 جيد (ضمن الحد)'
      : cpp <= product.maxCpp * 1.1 ? '🟠 قريب من الحد'
      : '🔴 تجاوز الحد';

    return [
      `${product.name} — ${status}`,
      `  Max CPP: ${product.maxCpp}ج.م | CPP فعلي: ${fmt.currency(cpp)}ج.م | ROAS: ${fmt.roas(roas)}x`,
      `  Spend: ${fmt.currency(totals.spend)}ج.م | Purchases: ${totals.purchases} | ATC: ${totals.addToCart}`,
      `  Impressions: ${fmt.int(totals.impressions)} | Avg Freq: ${fmt.percent(totals.avgFrequency)} | Avg CTR: ${fmt.pct(totals.avgCtr)}`,
      `  Hook Rate: ${fmt.pct(totals.avgHook)} | Hold Rate: ${fmt.pct(totals.avgHold)}`
    ].join('\n');
  }).join('\n\n');

  const prompt = `أنت مستشار إعلانات رقمية خبير في Meta Ads وتحسين الأداء للسوق المصري.

البيانات التالية تغطي آخر 3 أيام للحملات الإعلانية:

${dataSection}

المطلوب: تقرير استراتيجي شامل يتضمن:

**1. ملخص الأداء العام (3 أيام)**
نظرة سريعة على الوضع الإجمالي.

**2. فرص الـ Scale (الأولوية القصوى)**
المنتجات التي يمكن زيادة ميزانيتها لأن CPP ممتاز ومستقر.
قدّم توصيات ميزانية محددة.

**3. المنتجات تحت المراقبة**
المنتجات التي تحتاج تحسيناً قبل الـ Scale.

**4. اقتراحات Optimization**
تحسينات تكتيكية: targeting، بديات، جدولة، وغيرها.

**5. توزيع الميزانية المقترح**
بناءً على الأداء، كيف تقترح توزيع الإنفاق بين المنتجات؟

**6. أولويات الأسبوع القادم**
3-5 إجراءات محددة وقابلة للتنفيذ.

التنسيق: مباشر، أرقام محددة، عربي واضح. مدير مشغول يقرأ هذا في 3 دقائق.

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
- ✅ ❌ 🔴 🟢 مسموح ومرحب
- الحد الأقصى: 1200 كلمة`;

  try {
    const response = await client.messages.create({
      model: config.anthropic.models.light,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text;
  } catch (err) {
    logger.error('Tri-day report generation failed', err);
    return `فشل توليد تقرير الـ 3 أيام: ${err.message}`;
  }
}

// تجميع أرقام الأيام الـ 3
function aggregateDays(rows) {
  const totals = {
    spend: 0, purchases: 0, purchaseValue: 0,
    impressions: 0, clicks: 0, addToCart: 0, checkouts: 0,
    sumFrequency: 0, sumCtr: 0, sumHook: 0, sumHold: 0, count: 0
  };

  for (const row of rows) {
    totals.spend += row.spend;
    totals.purchases += row.purchases;
    totals.impressions += row.impressions;
    totals.clicks += row.clicks;
    totals.addToCart += row.add_to_cart;
    totals.checkouts += row.checkouts;
    totals.sumFrequency += row.frequency;
    totals.sumCtr += row.ctr;
    totals.sumHook += row.hook_rate;
    totals.sumHold += row.hold_rate;
    totals.count++;
  }

  totals.avgFrequency = totals.count > 0 ? totals.sumFrequency / totals.count : 0;
  totals.avgCtr = totals.count > 0 ? totals.sumCtr / totals.count : 0;
  totals.avgHook = totals.count > 0 ? totals.sumHook / totals.count : 0;
  totals.avgHold = totals.count > 0 ? totals.sumHold / totals.count : 0;

  return totals;
}

module.exports = { generateTriDayReport };
