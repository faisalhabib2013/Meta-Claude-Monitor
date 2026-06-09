const { getBot, getContext, setUserState, getUserState, clearUserState, sendTo, editMessage } = require('./bot');
const { pauseAdset, reduceBudget, getAdsetBudget } = require('../meta/actions');
const { formatPauseConfirmation, formatBudgetConfirmation, fmt } = require('../utils/format');
const logger = require('../utils/logger');

// نقطة دخول كل الـ callback queries
async function handleCallback(query) {
  const chatId = String(query.message.chat.id);
  const messageId = query.message.message_id;
  const data = query.data;

  if (data.startsWith('pause:')) {
    await handlePauseRequest(chatId, messageId, data);
  } else if (data.startsWith('budget_menu:')) {
    await handleBudgetMenu(chatId, messageId, data);
  } else if (data.startsWith('budget_pct:')) {
    await handleBudgetReduction(chatId, messageId, data);
  } else if (data.startsWith('budget_custom:')) {
    await handleBudgetCustomRequest(chatId, messageId, data);
  } else if (data.startsWith('confirm_pause:')) {
    await handleConfirmPause(chatId, messageId, data);
  } else if (data.startsWith('cancel')) {
    await handleCancel(chatId, messageId);
  }
}

// طلب إيقاف Ad Set → اسأل للتأكيد
async function handlePauseRequest(chatId, messageId, data) {
  const ctxKey = data.replace('pause:', '');
  const ctx = getContext(ctxKey);
  if (!ctx) return sendTo(chatId, '❌ انتهت صلاحية هذا الطلب.');

  const confirmKey = `confirm_pause:${ctxKey}`;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ تأكيد الإيقاف', callback_data: confirmKey },
      { text: '❌ إلغاء', callback_data: 'cancel' }
    ]]
  };

  await editMessage(chatId, messageId,
    `⏸ *تأكيد إيقاف Ad Set*\n\n` +
    `📑 *${ctx.adsetName}*\n` +
    `🗂 ${ctx.campaignName}\n\n` +
    `سيتم إضافة "claude edit" للاسم لتمييزه.`,
    { reply_markup: keyboard }
  );
}

// تأكيد الإيقاف → نفذ
async function handleConfirmPause(chatId, messageId, data) {
  const ctxKey = data.replace('confirm_pause:', '');
  const ctx = getContext(ctxKey);
  if (!ctx) return sendTo(chatId, '❌ انتهت صلاحية هذا الطلب.');

  try {
    const result = await pauseAdset(ctx.adsetId);

    await editMessage(chatId, messageId,
      formatPauseConfirmation(result.newName, ctx.campaignName)
    );

    // إخطار جميع المستخدمين
    const config = require('../config');
    for (const cid of config.telegram.chatIds) {
      if (String(cid) !== chatId) {
        await sendTo(cid,
          `⏸ *تم إيقاف Ad Set*\n\n` +
          `📑 ${result.newName}\n🗂 ${ctx.campaignName}\n` +
          `👤 بواسطة: المستخدم (${chatId})`
        );
      }
    }
  } catch (err) {
    logger.error('Pause adset failed', err);
    await editMessage(chatId, messageId,
      `❌ *فشل إيقاف Ad Set*\n\n${err.message}`
    );
  }
}

// قائمة تقليل الميزانية
async function handleBudgetMenu(chatId, messageId, data) {
  const ctxKey = data.replace('budget_menu:', '');
  const ctx = getContext(ctxKey);
  if (!ctx) return sendTo(chatId, '❌ انتهت صلاحية هذا الطلب.');

  // جلب الميزانية الحالية
  let currentBudget = ctx.currentBudgetEGP;
  try {
    const fresh = await getAdsetBudget(ctx.adsetId);
    currentBudget = fresh.dailyBudgetEGP;
  } catch {}

  const keyboard = {
    inline_keyboard: [
      [
        { text: '‎-20%', callback_data: `budget_pct:${ctxKey}:20` },
        { text: '‎-30%', callback_data: `budget_pct:${ctxKey}:30` },
        { text: '‎-50%', callback_data: `budget_pct:${ctxKey}:50` }
      ],
      [
        { text: '✍️ نسبة مخصصة', callback_data: `budget_custom:${ctxKey}` }
      ],
      [
        { text: '❌ إلغاء', callback_data: 'cancel' }
      ]
    ]
  };

  await editMessage(chatId, messageId,
    `💰 *تقليل الميزانية*\n\n` +
    `📑 ${ctx.adsetName}\n` +
    `💵 الميزانية الحالية: *${fmt.currency(currentBudget)} ج.م / يوم*\n` +
    `⚠️ الحد الأدنى: 55 ج.م\n\n` +
    `اختر النسبة:`,
    { reply_markup: keyboard }
  );
}

// تطبيق تقليل بنسبة محددة
async function handleBudgetReduction(chatId, messageId, data) {
  const parts = data.split(':');
  const ctxKey = parts[1];
  const percent = parseInt(parts[2]);
  const ctx = getContext(ctxKey);
  if (!ctx) return sendTo(chatId, '❌ انتهت صلاحية هذا الطلب.');

  try {
    const result = await reduceBudget(ctx.adsetId, percent);

    if (!result.success) {
      return editMessage(chatId, messageId, `❌ *تعذّر تقليل الميزانية*\n\n${result.error}`);
    }

    const successMsg = formatBudgetConfirmation(
      result.adsetName, result.oldBudgetEGP, result.newBudgetEGP, percent
    );
    await editMessage(chatId, messageId, successMsg);

    // إخطار بقية المستخدمين
    const config = require('../config');
    for (const cid of config.telegram.chatIds) {
      if (String(cid) !== chatId) {
        await sendTo(cid,
          `💰 *تم تقليل الميزانية*\n\n` +
          `📑 ${result.adsetName}\n` +
          `${fmt.currency(result.oldBudgetEGP)} ← *${fmt.currency(result.newBudgetEGP)} ج.م* (‎-${percent}%)\n` +
          `👤 بواسطة: المستخدم (${chatId})`
        );
      }
    }
  } catch (err) {
    logger.error('Budget reduction failed', err);
    await editMessage(chatId, messageId, `❌ *فشل تقليل الميزانية*\n\n${err.message}`);
  }
}

// طلب إدخال نسبة مخصصة
async function handleBudgetCustomRequest(chatId, messageId, data) {
  const ctxKey = data.replace('budget_custom:', '');
  const ctx = getContext(ctxKey);
  if (!ctx) return sendTo(chatId, '❌ انتهت صلاحية هذا الطلب.');

  setUserState(chatId, {
    type: 'awaiting_custom_budget',
    ctxKey,
    messageId
  });

  await sendTo(chatId,
    `✍️ اكتب النسبة المطلوبة (بدون %):\n_مثال: 35 يعني تقليل 35%_\n\n` +
    `📌 النطاق المسموح: 1% - 90%`
  );
}

// معالجة إدخال النسبة المخصصة
async function handleCustomBudgetInput(chatId, text, state) {
  const percent = parseInt(text.trim());

  if (isNaN(percent) || percent < 1 || percent > 90) {
    return sendTo(chatId, '❌ نسبة غير صحيحة. أدخل رقم بين 1 و90.');
  }

  clearUserState(chatId);

  const ctx = getContext(state.ctxKey);
  if (!ctx) return sendTo(chatId, '❌ انتهت صلاحية الطلب. انتظر تنبيه جديد.');

  try {
    const result = await reduceBudget(ctx.adsetId, percent);

    if (!result.success) {
      return sendTo(chatId, `❌ تعذّر تقليل الميزانية\n\n${result.error}`);
    }

    const successMsg = formatBudgetConfirmation(
      result.adsetName, result.oldBudgetEGP, result.newBudgetEGP, percent
    );
    await sendTo(chatId, successMsg);

    // إخطار بقية المستخدمين
    const config = require('../config');
    for (const cid of config.telegram.chatIds) {
      if (String(cid) !== chatId) {
        await sendTo(cid,
          `💰 *تم تقليل الميزانية (مخصص)*\n\n` +
          `📑 ${result.adsetName}\n` +
          `${fmt.currency(result.oldBudgetEGP)} ← *${fmt.currency(result.newBudgetEGP)} ج.م* (‎-${percent}%)\n` +
          `👤 بواسطة: المستخدم (${chatId})`
        );
      }
    }
  } catch (err) {
    logger.error('Custom budget reduction failed', err);
    await sendTo(chatId, `❌ فشلت العملية: ${err.message}`);
  }
}

// إلغاء العملية
async function handleCancel(chatId, messageId) {
  clearUserState(chatId);
  await editMessage(chatId, messageId, '❌ *تم إلغاء العملية.*');
}

module.exports = {
  handleCallback,
  handleCustomBudgetInput
};
