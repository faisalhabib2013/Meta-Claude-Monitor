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

// تخزين سياق الأزرار وإرجاع مفتاح قصير
function storeContext(data) {
  const key = `c${++ctxCounter}`;
  actionContext.set(key, { ...data, timestamp: Date.now() });

  // تنظيف السياق القديم (أكبر من 24 ساعة)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of actionContext.entries()) {
    if (v.timestamp < cutoff) actionContext.delete(k);
  }

  return key;
}

function getContext(key) {
  return actionContext.get(key) || null;
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
  const { handleCallback } = require('./handlers');
  const bot = getBot();

  try {
    await bot.answerCallbackQuery(query.id);
    await handleCallback(query);
  } catch (err) {
    logger.error('Callback query error', err);
    await bot.answerCallbackQuery(query.id, {
      text: '❌ حدث خطأ. حاول مرة تانية.',
      show_alert: true
    }).catch(() => {});
  }
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

module.exports = {
  initBot,
  getBot,
  storeContext,
  getContext,
  setUserState,
  getUserState,
  clearUserState,
  broadcast,
  sendTo,
  editMessage
};
