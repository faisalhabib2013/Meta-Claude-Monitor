const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const db = require('../db');
const { todayString, daysAgoString } = require('../utils/time');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM = `أنت مساعد ميديا باير محترف لنظام مراقبة إعلانات Meta و TikTok لعلامة تجارية مصرية.
عندك بيانات أداء حقيقية وأدوات للاستعلام واقتراح إجراءات.

قواعد مهمة:
- أجب بالعربي، مباشر وموجز، بأرقام محددة
- الأرقام بالجنيه المصري
- لو المستخدم طلب إجراء (إيقاف/تعديل ميزانية)، استخدم أدوات الاقتراح — التنفيذ يتطلب تأكيد المستخدم بزر
- adset_id الذي يبدأ بـ tt_ يعني TikTok، وغير ذلك Meta
- لا تستخدم ## أو جداول | في ردودك (Telegram لا يدعمها)
- لو السؤال يحتاج بيانات تاريخية استخدم get_product_history`;

const tools = [
  {
    name: 'get_product_history',
    description: 'جلب الأداء اليومي لمنتج معين خلال آخر N يوم، مفصلاً per adset',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'اسم المنتج كما في products.json' },
        days: { type: 'integer', description: 'عدد الأيام (افتراضي 7، أقصى 30)' }
      },
      required: ['product_name']
    }
  },
  {
    name: 'propose_pause_adset',
    description: 'اقتراح إيقاف Ad Set معين — سيظهر زر تأكيد للمستخدم ولن يُنفذ إلا بموافقته',
    input_schema: {
      type: 'object',
      properties: {
        adset_id: { type: 'string', description: 'الـ adset_id من البيانات' },
        reason: { type: 'string', description: 'سبب الاقتراح بالعربي' }
      },
      required: ['adset_id', 'reason']
    }
  },
  {
    name: 'propose_budget_change',
    description: 'اقتراح رفع أو خفض ميزانية Ad Set — سيظهر زر تأكيد للمستخدم',
    input_schema: {
      type: 'object',
      properties: {
        adset_id: { type: 'string' },
        percent: { type: 'integer', description: 'النسبة 1-100' },
        direction: { type: 'string', enum: ['increase', 'decrease'] },
        reason: { type: 'string' }
      },
      required: ['adset_id', 'percent', 'direction', 'reason']
    }
  }
];

// تنفيذ الأدوات
async function executeTool(name, input, chatId) {
  const today = todayString();

  if (name === 'get_product_history') {
    const days = Math.min(input.days || 7, 30);
    const rows = db.getDailyMetricsByProduct(input.product_name, daysAgoString(days - 1), today);
    if (!rows.length) return `لا توجد بيانات لـ ${input.product_name} خلال آخر ${days} يوم`;
    const compact = rows.map(r => ({
      date: r.date,
      adset_id: r.adset_id,
      adset: r.adset_name,
      platform: r.adset_id.startsWith('tt_') ? 'tiktok' : 'meta',
      spend: +r.spend.toFixed(1),
      purchases: r.purchases,
      cpp: +r.cpp.toFixed(1),
      ctr: +(r.ctr || 0).toFixed(2),
      frequency: +(r.frequency || 0).toFixed(2)
    }));
    return JSON.stringify(compact);
  }

  if (name === 'propose_pause_adset' || name === 'propose_budget_change') {
    // إيجاد بيانات الـ adset من اليوم أو آخر 3 أيام
    let row = db.getAllAdsetMetricsToday(today).find(r => r.adset_id === input.adset_id);
    if (!row) {
      const recent = db.getAdsetHistory(input.adset_id, 3);
      row = recent[recent.length - 1];
    }
    if (!row) return `لم أجد بيانات للـ adset_id: ${input.adset_id}`;

    const { storeContext, sendTo } = require('../telegram/bot');
    const platform = row.adset_id.startsWith('tt_') ? 'tiktok' : 'meta';
    const ctxKey = storeContext({
      accountId: row.account_id,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      productName: row.product_name,
      platform
    });

    const cleanName = String(row.adset_name).replace(/\*/g, '').replace(/_/g, '-');

    if (name === 'propose_pause_adset') {
      const keyboard = { inline_keyboard: [[
        { text: '✅ تأكيد الإيقاف', callback_data: `confirm_pause:${ctxKey}` },
        { text: '❌ إلغاء', callback_data: 'cancel' }
      ]]};
      await sendTo(chatId,
        `🤖 *اقتراح المساعد: إيقاف Ad Set*\n\n📑 ${cleanName}\n📦 ${row.product_name}\n\n💭 السبب: ${input.reason}`,
        { reply_markup: keyboard }
      );
      return 'تم عرض زر التأكيد للمستخدم — القرار النهائي له.';
    }

    // budget change
    const pct = Math.max(1, Math.min(100, input.percent));
    const cb = input.direction === 'increase'
      ? `confirm_scale:${ctxKey}:${pct}`
      : `budget_pct:${ctxKey}:${pct}`;
    const sign = input.direction === 'increase' ? '+' : '-';
    const keyboard = { inline_keyboard: [[
      { text: `✅ تأكيد ${sign}${pct}%`, callback_data: cb },
      { text: '❌ إلغاء', callback_data: 'cancel' }
    ]]};
    await sendTo(chatId,
      `🤖 *اقتراح المساعد: ${input.direction === 'increase' ? 'رفع' : 'خفض'} الميزانية ${sign}${pct}%*\n\n📑 ${cleanName}\n📦 ${row.product_name}\n\n💭 السبب: ${input.reason}`,
      { reply_markup: keyboard }
    );
    return 'تم عرض زر التأكيد للمستخدم — القرار النهائي له.';
  }

  return 'أداة غير معروفة';
}

// الحلقة الرئيسية للمساعد
async function runAssistant(question, chatId) {
  const today = todayString();
  const rows = db.getAllAdsetMetricsToday(today);
  const products = require('../../config/products.json').products;

  const summary = rows.map(r => ({
    adset_id: r.adset_id,
    adset: r.adset_name,
    campaign: r.campaign_name,
    product: r.product_name,
    platform: r.adset_id.startsWith('tt_') ? 'tiktok' : 'meta',
    spend: +r.spend.toFixed(1),
    purchases: r.purchases,
    cpp: +r.cpp.toFixed(1),
    max_cpp: r.max_cpp
  }));

  const productsInfo = products.map(p => `${p.name} (Max CPP: ${p.maxCpp})`).join(', ');

  let messages = [{
    role: 'user',
    content: `المنتجات المسجلة: ${productsInfo}\n\nبيانات اليوم ${today} (per adset):\n${JSON.stringify(summary)}\n\n❓ سؤال المستخدم: ${question}`
  }];

  try {
    for (let i = 0; i < 5; i++) {
      const res = await client.messages.create({
        model: config.anthropic.models.heavy,
        max_tokens: 1500,
        system: SYSTEM,
        tools,
        messages
      });

      if (res.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: res.content });
        const results = [];
        for (const block of res.content) {
          if (block.type === 'tool_use') {
            logger.info(`[Assistant] tool: ${block.name}`);
            const out = await executeTool(block.name, block.input, chatId);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: String(out) });
          }
        }
        messages.push({ role: 'user', content: results });
      } else {
        return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      }
    }
    return '⚠️ وصلت للحد الأقصى من خطوات التحليل. جرّب سؤالاً أبسط.';
  } catch (err) {
    logger.error('Assistant failed', err);
    return `❌ حدث خطأ: ${err.message}`;
  }
}

module.exports = { runAssistant };
