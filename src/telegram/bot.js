const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const logger = require('../utils/logger');

let bot = null;

// حالة المحادثة لكل مستخدم (للعمليات متعددة الخطوات)
const userStates = new Map(); // chatId -> state

// سياق الأزرار (مؤقت في الذاكرة)
let ctxCounter = 0;
const actionContext = new Map(); // ctxKey -> data

function initBot() {
  if (bot) return bot;

  bot = new TelegramBot(config.telegram.botToken, {
    polling: {
      interval: 1000,
      autoStart: true,
      params: { timeout: 10 }
    }
  });

  bot.on('polling_error', (err) => {
    logger.error('Telegram polling error', err);
  });

  // تهيئة مخزن الإعدادات الديناميكي (منتجات/حسابات من قاعدة البيانات)
  try { require('../configStore').init(); }
  catch (e) { logger.error('ConfigStore init error', e); }

  // معالجة /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
      `👋 *مرحباً!*\n\n` +
      `معرف حسابك: \`${chatId}\`\n\n` +
      `📌 أضف هذا الـ ID في ملف \`.env\` كـ:\n` +
      `\`TELEGRAM_USER_CHAT_ID=${chatId}\`\n` +
      `أو\n` +
      `\`TELEGRAM_MEDIA_BUYER_CHAT_ID=${chatId}\``,
      { parse_mode: 'Markdown' }
    );
    logger.info(`New chat started: ${chatId} (@${msg.from.username || 'unknown'})`);
  });

  // معالجة /status
  bot.onText(/\/status/, async (msg) => {
    const { sendStatusMessage } = require('./alerts');
    await sendStatusMessage(msg.chat.id);
  });

  // /help — قائمة بكل الأوامر المتاحة (نص عادي بدون Markdown لضمان الوصول)
  bot.onText(/\/help/, async (msg) => {
    const chatId = String(msg.chat.id);
    const helpText =
`🤖 Meta & TikTok Ads Monitor
قائمة الأوامر المتاحة

📊 المتابعة والأداء
/status — حالة النظام وأداء اليوم
/top — أفضل 3 منتجات أداءً اليوم
/worst — أسوأ 3 منتجات أداءً اليوم
/budget — إجمالي الإنفاق + توقع نهاية اليوم

🔍 تفاصيل المنتجات
/product اسم — أداء المنتج per adset آخر 3 أيام
/week اسم — أداء المنتج per adset آخر 7 أيام

⚙️ التحكم في الحملات
/pause_product اسم — إيقاف كل Ad Sets لمنتج
(أزرار الإيقاف والميزانية تظهر في التنبيهات)

🤖 المساعد الذكي
/ask سؤال — اسأل عن أي حملة أو اطلب إجراء
مثال: /ask ايه رأيك في أداء خرز النهارده؟

🛠 إدارة الإعدادات
/products — قائمة المنتجات وحدودها
/add_product اسم حد — إضافة منتج
/edit_cpp اسم حد — تعديل Max CPP
/remove_product اسم — حذف منتج
/add_alias منتج = اسم-بديل — ربط اسم إضافي بمنتج
/remove_alias منتج = اسم-بديل — حذف اسم بديل
/accounts — قائمة الحسابات
/add_account meta أو tiktok ثم ID — إضافة حساب
/remove_account meta أو tiktok ثم ID — إزالة حساب
/settings — عرض إعدادات المراقبة
/set إعداد قيمة — تعديل إعداد

🔄 النظام
/check — تشغيل دورة فحص فورية الآن
/help — عرض هذه القائمة

💡 أمثلة:
/product خرز
/edit_cpp خرز 65
/set cooldown 4`;

    const b = getBot();
    await b.sendMessage(chatId, helpText); // بدون parse_mode — مضمون الوصول
  });

  // /check — تشغيل دورة فحص فورية
  bot.onText(/\/check/, async (msg) => {
    await sendTo(String(msg.chat.id), '🔄 جاري تشغيل دورة فحص فورية...');
    try {
      const { triggerManualCheck } = require('../scheduler');
      await triggerManualCheck();
    } catch (err) {
      await sendTo(String(msg.chat.id), '⚠️ الدورة كانت شغالة بالفعل، انتظر قليلاً.');
    }
  });

  // /budget — إجمالي الإنفاق + التوقع
  bot.onText(/\/budget/, async (msg) => {
    const { sendBudgetReport } = require('./alerts');
    await sendBudgetReport(String(msg.chat.id));
  });

  // /top — أفضل 3 منتجات
  bot.onText(/\/top/, async (msg) => {
    const { sendTopProducts } = require('./alerts');
    await sendTopProducts(String(msg.chat.id));
  });

  // /pause_product [اسم المنتج] — إيقاف كل ad sets لمنتج
  bot.onText(/\/pause_product (.+)/, async (msg, match) => {
    const productName = match[1].trim();
    const chatId = String(msg.chat.id);

    const db = require('../db');
    const { todayString } = require('../utils/time');
    const today = todayString();
    const todayMetrics = db.getAllAdsetMetricsToday(today)
      .filter(m => m.product_name === productName);

    if (!todayMetrics.length) {
      return sendTo(chatId, `❌ لم يتم العثور على حملات نشطة اليوم لمنتج: *${productName}*`);
    }

    // تجميع الـ adsets الفريدة
    const uniqueAdsets = {};
    todayMetrics.forEach(m => { uniqueAdsets[m.adset_id] = m; });
    const count = Object.keys(uniqueAdsets).length;

    // طلب التأكيد
    const ctxKey = storeContext({ pauseProductName: productName, adsets: uniqueAdsets });
    const keyboard = {
      inline_keyboard: [[
        { text: `✅ تأكيد إيقاف ${count} Ad Sets`, callback_data: `pause_product_confirm:${ctxKey}` },
        { text: '❌ إلغاء', callback_data: 'cancel' }
      ]]
    };

    let adsetList = Object.values(uniqueAdsets).slice(0, 5)
      .map(m => `• ${m.adset_name}`)
      .join('\n');
    if (count > 5) adsetList += `\n• ... و${count - 5} آخرين`;

    await sendTo(chatId,
      `⚠️ *تأكيد إيقاف منتج: ${productName}*\n\n${adsetList}\n\nإجمالي: ${count} Ad Set`,
      { reply_markup: keyboard }
    );
  });

  // /product [name] — أداء المنتج per adset خلال آخر 3 أيام
  bot.onText(/\/product (.+)/, async (msg, match) => {
    const query = match[1].trim();
    const chatId = String(msg.chat.id);
    await sendTo(chatId, `🔍 جاري جلب بيانات: *${query}*...`);
    const { sendProductReport } = require('./alerts');
    await sendProductReport(chatId, query, 3).catch(async err => {
      await sendTo(chatId, `❌ خطأ: ${err.message}`);
    });
  });

  // /week [name] — ملخص 7 أيام للمنتج
  bot.onText(/\/week (.+)/, async (msg, match) => {
    const query = match[1].trim();
    const chatId = String(msg.chat.id);
    await sendTo(chatId, `📅 جاري جلب بيانات 7 أيام: *${query}*...`);
    const { sendProductReport } = require('./alerts');
    await sendProductReport(chatId, query, 7).catch(async err => {
      await sendTo(chatId, `❌ خطأ: ${err.message}`);
    });
  });

  // /worst — أسوأ 3 منتجات أداءً اليوم
  bot.onText(/\/worst/, async (msg) => {
    const { sendWorstProducts } = require('./alerts');
    await sendWorstProducts(String(msg.chat.id));
  });

  // /ask [سؤال] — مساعد AI بأدوات حقيقية
  bot.onText(/\/ask (.+)/s, async (msg, match) => {
    const question = match[1].trim();
    const chatId = String(msg.chat.id);
    await sendTo(chatId, '🤔 جاري التحليل...');
    try {
      const { runAssistant } = require('../ai/assistant');
      const answer = await runAssistant(question, chatId);
      // إرسال كنص عادي بدون Markdown لتجنب أخطاء parse
      const b = getBot();
      await b.sendMessage(chatId, answer);
    } catch (err) {
      await sendTo(chatId, `❌ خطأ: ${err.message}`);
    }
  });

  // ==================== أوامر إدارة الإعدادات ====================

  // /products — قائمة المنتجات الحالية
  bot.onText(/\/products/, async (msg) => {
    const store = require('../configStore');
    const products = store.getProducts();
    if (!products.length) return sendTo(String(msg.chat.id), '📦 لا توجد منتجات مسجلة.');
    let text = `📦 المنتجات المسجلة (${products.length})\n\n`;
    products.forEach((p, i) => {
      text += `${i + 1}. ${p.name} — Max CPP: ${p.maxCpp} ج.م\n`;
      if (p.aliases && p.aliases.length) {
        text += `   ↳ أسماء بديلة: ${p.aliases.join(' ، ')}\n`;
      }
    });
    text += `\n💡 /add_product اسم حد — لإضافة منتج`;
    await sendPlain(String(msg.chat.id), text);
  });

  // /add_product [اسم المنتج] [maxCpp]
  bot.onText(/\/add_product (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const tokens = match[1].trim().split(/\s+/);
    const maxCpp = parseFloat(tokens[tokens.length - 1]);
    const name = tokens.slice(0, -1).join(' ');
    if (isNaN(maxCpp) || !name) {
      return sendPlain(chatId, '❌ الصيغة: /add_product اسم-المنتج الحد\nمثال: /add_product خرز جديد 60');
    }
    const store = require('../configStore');
    const result = store.addProduct(name, maxCpp);
    if (!result.ok) return sendPlain(chatId, `❌ ${result.error}`);
    await sendPlain(chatId,
      `✅ تم إضافة المنتج\n\n📦 ${result.name}\n💰 Max CPP: ${result.maxCpp} ج.م\n\n` +
      `إجمالي المنتجات: ${result.total}\n🔄 المراقبة تشمله من الدورة القادمة تلقائياً.`
    );
  });

  // /edit_cpp [اسم المنتج] [maxCpp الجديد]
  bot.onText(/\/edit_cpp (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const tokens = match[1].trim().split(/\s+/);
    const maxCpp = parseFloat(tokens[tokens.length - 1]);
    const name = tokens.slice(0, -1).join(' ');
    if (isNaN(maxCpp) || !name) {
      return sendPlain(chatId, '❌ الصيغة: /edit_cpp اسم-المنتج الحد-الجديد\nمثال: /edit_cpp خرز 65');
    }
    const store = require('../configStore');
    const result = store.editCpp(name, maxCpp);
    if (!result.ok) return sendPlain(chatId, `❌ ${result.error}`);
    await sendPlain(chatId,
      `✅ تم تعديل الحد\n\n📦 ${result.name}\n💰 ${result.oldCpp} ج.م ← ${result.maxCpp} ج.م`
    );
  });

  // /remove_product [اسم المنتج] — بتأكيد
  bot.onText(/\/remove_product (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const name = match[1].trim();
    const store = require('../configStore');
    const product = store.findProduct(name);
    if (!product) return sendPlain(chatId, `❌ لم أجد منتجاً باسم "${name}"`);

    const ctxKey = storeContext({ cfgAction: 'rmprod', name: product.name });
    const keyboard = { inline_keyboard: [[
      { text: '✅ تأكيد الحذف', callback_data: `cfgstore:${ctxKey}` },
      { text: '❌ إلغاء', callback_data: 'cancel' }
    ]]};
    await sendPlain(chatId,
      `⚠️ تأكيد حذف المنتج\n\n📦 ${product.name} (Max CPP: ${product.maxCpp})\n\n` +
      `سيتوقف النظام عن مراقبة حملاته.`,
      { reply_markup: keyboard }
    );
  });

  // /add_alias [منتج] = [اسم بديل] — ربط اسم إضافي بمنتج موجود
  bot.onText(/\/add_alias (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const parts = match[1].split('=');
    if (parts.length !== 2) {
      return sendPlain(chatId,
        '❌ الصيغة: /add_alias اسم-المنتج = الاسم-البديل\n' +
        'مثال: /add_alias كريم ازالة = wart cream'
      );
    }
    const store = require('../configStore');
    const result = store.addAlias(parts[0].trim(), parts[1].trim());
    if (!result.ok) return sendPlain(chatId, `❌ ${result.error}`);
    await sendPlain(chatId,
      `✅ تم إضافة اسم بديل\n\n📦 ${result.name}\n➕ "${result.alias}"\n\n` +
      `الأسماء البديلة الآن: ${result.aliases.join(' ، ')}\n` +
      `🔄 أي حملة تحتوي أياً منها ستُنسب لهذا المنتج من الدورة القادمة.`
    );
  });

  // /remove_alias [منتج] = [اسم بديل]
  bot.onText(/\/remove_alias (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const parts = match[1].split('=');
    if (parts.length !== 2) {
      return sendPlain(chatId,
        '❌ الصيغة: /remove_alias اسم-المنتج = الاسم-البديل\n' +
        'مثال: /remove_alias كريم ازالة = wart cream'
      );
    }
    const store = require('../configStore');
    const result = store.removeAlias(parts[0].trim(), parts[1].trim());
    if (!result.ok) return sendPlain(chatId, `❌ ${result.error}`);
    const remaining = result.aliases.length ? result.aliases.join(' ، ') : 'لا يوجد';
    await sendPlain(chatId,
      `✅ تم حذف الاسم البديل\n\n📦 ${result.name}\n➖ "${result.alias}"\n\n` +
      `الأسماء البديلة المتبقية: ${remaining}`
    );
  });

  // /accounts — قائمة الحسابات
  bot.onText(/\/accounts/, async (msg) => {
    const store = require('../configStore');
    const acc = store.getAccounts();
    let text = `🏦 الحسابات المسجلة\n\n`;
    text += `🔵 Meta (${acc.meta.length}):\n`;
    acc.meta.forEach(id => { text += `• ${id}\n`; });
    text += `\n🎵 TikTok (${acc.tiktok.length}):\n`;
    acc.tiktok.forEach(id => { text += `• ${id}\n`; });
    text += `\n💡 /add_account meta ID أو /add_account tiktok ID`;
    await sendPlain(String(msg.chat.id), text);
  });

  // /add_account [meta|tiktok] [ID]
  bot.onText(/\/add_account (meta|tiktok) (\d+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const store = require('../configStore');
    const result = store.addAccount(match[1], match[2]);
    if (!result.ok) return sendPlain(chatId, `❌ ${result.error}`);
    await sendPlain(chatId,
      `✅ تم إضافة حساب ${result.platform}\n\n🆔 ${result.id}\n` +
      `إجمالي حسابات ${result.platform}: ${result.total}\n\n` +
      `🔄 المراقبة تشمله من الدورة القادمة — جرّب /check للفحص الفوري.`
    );
  });

  // /remove_account [meta|tiktok] [ID] — بتأكيد
  bot.onText(/\/remove_account (meta|tiktok) (\d+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const platform = match[1];
    const id = match[2];
    const ctxKey = storeContext({ cfgAction: 'rmacct', platform, id });
    const keyboard = { inline_keyboard: [[
      { text: '✅ تأكيد الإزالة', callback_data: `cfgstore:${ctxKey}` },
      { text: '❌ إلغاء', callback_data: 'cancel' }
    ]]};
    await sendPlain(chatId,
      `⚠️ تأكيد إزالة حساب ${platform === 'meta' ? 'Meta' : 'TikTok'}\n\n🆔 ${id}\n\n` +
      `سيتوقف النظام عن مراقبة حملاته.`,
      { reply_markup: keyboard }
    );
  });

  // /settings — عرض الإعدادات الحالية
  bot.onText(/\/settings/, async (msg) => {
    const store = require('../configStore');
    const s = store.getSettingsView();
    let text = `⚙️ إعدادات النظام الحالية\n\n`;
    text += `📦 المنتجات: ${s.products}\n`;
    text += `🔵 حسابات Meta: ${s.metaAccounts.length}\n`;
    text += `🎵 حسابات TikTok: ${s.tiktokAdvertisers.length}\n\n`;
    text += `⏱ الفحص كل: ${s.intervalMin} دقيقة (ثابت)\n`;
    text += `🔕 cooldown: ${s.cooldownHours} ساعة\n`;
    text += `📊 buffer: ${s.bufferPct}% من Max CPP\n`;
    text += `🛒 min_purchases: ${s.minPurchases}\n`;
    text += `💸 high_spend: ${s.highSpendPct}%\n\n`;
    text += `💡 للتعديل: /set الإعداد القيمة\nمثال: /set cooldown 4`;
    await sendPlain(String(msg.chat.id), text);
  });

  // /set [إعداد] [قيمة]
  bot.onText(/\/set (\w+) ([\d.]+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const store = require('../configStore');
    const result = store.setSetting(match[1], match[2]);
    if (!result.ok) return sendPlain(chatId, `❌ ${result.error}`);
    await sendPlain(chatId,
      `✅ تم تحديث الإعداد\n\n${result.label}: ${result.value} ${result.unit}\n\n` +
      `🔄 مُطبَّق فوراً على الدورات القادمة.`
    );
  });

  // معالجة رسائل نصية (للـ custom budget input)
  bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
      handleTextInput(msg);
    }
  });

  // معالجة ضغطات الأزرار
  bot.on('callback_query', (query) => {
    handleCallbackQuery(query);
  });

  logger.success('Telegram bot initialized');
  return bot;
}

function getBot() {
  if (!bot) throw new Error('Bot not initialized. Call initBot() first.');
  return bot;
}

// تخزين سياق الأزرار — في الذاكرة + قاعدة البيانات (يعيش بعد الـ restart)
function storeContext(data) {
  // مفتاح فريد حتى بعد إعادة التشغيل (timestamp-based)
  const key = `c${Date.now().toString(36)}${++ctxCounter}`;
  const record = { ...data, timestamp: Date.now() };
  actionContext.set(key, record);

  // حفظ دائم في قاعدة البيانات
  try {
    const db = require('../db');
    db.setState(`ctx:${key}`, JSON.stringify(record));

    // تنظيف السياقات الأقدم من 48 ساعة
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    for (const k of db.getStateKeys('ctx:')) {
      try {
        const v = JSON.parse(db.getState(k) || '{}');
        if (!v.timestamp || v.timestamp < cutoff) db.deleteState(k);
      } catch { db.deleteState(k); }
    }
  } catch (e) { /* الذاكرة تكفي كـ fallback */ }

  // تنظيف الذاكرة
  const memCutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of actionContext.entries()) {
    if (v.timestamp < memCutoff) actionContext.delete(k);
  }

  return key;
}

function getContext(key) {
  // الذاكرة أولاً، ثم قاعدة البيانات (بعد الـ restart)
  if (actionContext.has(key)) return actionContext.get(key);
  try {
    const db = require('../db');
    const v = db.getState(`ctx:${key}`);
    if (v) {
      const record = JSON.parse(v);
      actionContext.set(key, record); // إعادة للذاكرة
      return record;
    }
  } catch (e) {}
  return null;
}

// حالة المستخدم (للمدخلات متعددة الخطوات)
function setUserState(chatId, state) {
  userStates.set(String(chatId), state);
}

function getUserState(chatId) {
  return userStates.get(String(chatId)) || null;
}

function clearUserState(chatId) {
  userStates.delete(String(chatId));
}

// معالجة الإدخال النصي (للـ custom budget)
async function handleTextInput(msg) {
  const chatId = String(msg.chat.id);
  const state = getUserState(chatId);

  if (!state) return;

  if (state.type === 'awaiting_custom_budget') {
    const { handleCustomBudgetInput } = require('./handlers');
    await handleCustomBudgetInput(chatId, msg.text, state);
  }
}

// معالجة callback queries (ضغطات الأزرار)
async function handleCallbackQuery(query) {
  const bot = getBot();

  try {
    await bot.answerCallbackQuery(query.id);

    // أزرار إدارة الإعدادات (حذف منتج / إزالة حساب)
    if ((query.data || '').startsWith('cfgstore:')) {
      await handleConfigStoreCallback(query);
      return;
    }

    const { handleCallback } = require('./handlers');
    await handleCallback(query);
  } catch (err) {
    logger.error('Callback query error', err);
    await bot.answerCallbackQuery(query.id, {
      text: '❌ حدث خطأ. حاول مرة تانية.',
      show_alert: true
    }).catch(() => {});
  }
}

// تنفيذ أزرار تأكيد إدارة الإعدادات
async function handleConfigStoreCallback(query) {
  const chatId = String(query.message.chat.id);
  const messageId = query.message.message_id;
  const key = query.data.replace('cfgstore:', '');
  const ctx = getContext(key);
  if (!ctx) return sendTo(chatId, '❌ انتهت صلاحية هذا الطلب.');

  const store = require('../configStore');

  const b = getBot();

  if (ctx.cfgAction === 'rmprod') {
    const result = store.removeProduct(ctx.name);
    const text = result.ok
      ? `✅ تم حذف المنتج\n\n📦 ${result.name}\nالمنتجات المتبقية: ${result.remaining}`
      : `❌ ${result.error}`;
    return b.editMessageText(text, { chat_id: chatId, message_id: messageId }).catch(() => sendPlain(chatId, text));
  }

  if (ctx.cfgAction === 'rmacct') {
    const result = store.removeAccount(ctx.platform, ctx.id);
    const text = result.ok
      ? `✅ تمت إزالة حساب ${result.platform}\n\n🆔 ${result.id}\nالحسابات المتبقية: ${result.remaining}`
      : `❌ ${result.error}`;
    return b.editMessageText(text, { chat_id: chatId, message_id: messageId }).catch(() => sendPlain(chatId, text));
  }

  return sendTo(chatId, '❌ إجراء غير معروف.');
}

// إرسال رسالة لكل الـ Chat IDs المسجلة
async function broadcast(text, options = {}) {
  const b = getBot();
  const results = [];

  for (const chatId of config.telegram.chatIds) {
    try {
      const msg = await b.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...options
      });
      results.push({ chatId, success: true, messageId: msg.message_id });
    } catch (err) {
      logger.error(`Failed to send to chat ${chatId}`, err);
      results.push({ chatId, success: false, error: err.message });
    }
  }

  return results;
}

// إرسال رسالة لـ chat معين
async function sendTo(chatId, text, options = {}) {
  const b = getBot();
  return b.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
}

// إرسال نص عادي بدون Markdown — مضمون الوصول (لرسائل فيها _ أو * أو أسماء ديناميكية)
async function sendPlain(chatId, text, options = {}) {
  const b = getBot();
  return b.sendMessage(chatId, text, { ...options, parse_mode: undefined });
}

// تعديل رسالة موجودة
async function editMessage(chatId, messageId, text, options = {}) {
  const b = getBot();
  try {
    return await b.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...options
    });
  } catch (err) {
    // قد تكون الرسالة قديمة جداً
    if (!err.message?.includes('message is not modified')) {
      logger.error('Edit message error', err);
    }
  }
}

// إرسال رسائل طويلة مقسّمة على أجزاء (حد Telegram = 4096 حرف)
// plain=true → إرسال بدون parse_mode (للتقارير AI)
async function broadcastLong(text, options = {}, plain = false) {
  const MAX_LEN = 3800;
  const sendOpts = plain ? { ...options, parse_mode: null } : options;
  const chunkHeader = (i, total) => total > 1 ? `(${i + 1}/${total})\n` : '';

  if (text.length <= MAX_LEN) {
    return [await broadcast(text, sendOpts)];
  }

  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? current + '\n' + line : line;
    if (candidate.length > MAX_LEN) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    await broadcast(chunkHeader(i, chunks.length) + chunks[i], sendOpts);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 700));
  }
  return results;
}

module.exports = {
  initBot,
  getBot,
  storeContext,
  getContext,
  setUserState,
  getUserState,
  clearUserState,
  broadcast,
  broadcastLong,
  sendTo,
  editMessage
};
