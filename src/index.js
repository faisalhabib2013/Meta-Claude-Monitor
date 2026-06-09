require('dotenv').config();
process.env.TZ = 'Africa/Cairo';

const logger = require('./utils/logger');
const { initBot } = require('./telegram/bot');
const { startAll, stopAll } = require('./scheduler');
const db = require('./db');

async function main() {
  logger.info('====================================');
  logger.info('  Meta Ads CPP Monitor v1.0');
  logger.info('====================================');

  // 1. تهيئة قاعدة البيانات
  db.getDb();
  logger.success('Database ready');

  // 2. تهيئة Telegram Bot
  initBot();
  logger.success('Telegram bot ready');

  // 3. إرسال رسالة تأكيد البدء
  const { broadcast } = require('./telegram/bot');
  const { cairoDateTime } = require('./utils/time');
  const products = require('../config/products.json').products;

  await broadcast(
    `🚀 *النظام بدأ التشغيل*\n\n` +
    `⏰ ${cairoDateTime()} (القاهرة)\n` +
    `📦 المنتجات تحت المراقبة: *${products.length}*\n` +
    `🏦 الحسابات: *${require('./config').meta.adAccountIds.length}*\n` +
    `⏱ الفحص كل: *90 دقيقة*\n\n` +
    `اكتب /status لرؤية حالة النظام.`
  ).catch(err => logger.error('Startup message failed', err));

  // 4. بدء الجدولة
  startAll();

  // معالجة الإيقاف الآمن
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
  });
}

async function gracefulShutdown() {
  logger.info('Shutting down gracefully...');
  stopAll();

  const { broadcast } = require('./telegram/bot');
  await broadcast('⚠️ *النظام تم إيقافه*').catch(() => {});

  process.exit(0);
}

main().catch(err => {
  logger.error('Fatal error during startup', err);
  process.exit(1);
});
