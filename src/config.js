require('dotenv').config();
const path = require('path');

const config = {
  meta: {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    accessToken: process.env.META_ACCESS_TOKEN,
    adAccountIds: process.env.AD_ACCOUNT_IDS.split(',').map(id => id.trim()),
    apiVersion: 'v20.0',
    baseUrl: 'https://graph.facebook.com'
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatIds: [
      process.env.TELEGRAM_USER_CHAT_ID,
      process.env.TELEGRAM_MEDIA_BUYER_CHAT_ID
    ].filter(Boolean)
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    models: {
      heavy: 'claude-sonnet-4-6',   // للتحليل العميق
      light: 'claude-haiku-4-5-20251001'  // للتقارير اليومية
    }
  },

  monitor: {
    intervalMs: 90 * 60 * 1000,          // فحص كل 90 دقيقة
    alertCooldownMs: 3 * 60 * 60 * 1000, // تنبيه للمنتج الواحد كل 3 ساعات كحد أقصى
    cppBuffer: 1.10,                       // تنبيه عند تجاوز 110% من الـ Max CPP
    minPurchases: 2,                       // حد أدنى للمشتريات
    highSpendMultiplier: 2.5,              // تنبيه لو spend > 250% من maxCpp بأقل من 2 مشتريات
    budgetFloorPiastres: 5500,             // 55 ج.م بالمليم (أصغر وحدة في API)
    consecutiveDaysForAnalysis: 2          // عدد الأيام المتتالية قبل التحليل العميق
  },

  schedule: {
    dailyReportHour: 21,  // 9 PM UTC = 11 PM Cairo (UTC+2)
    dailyReportMinute: 0,
    triDayReportIntervalDays: 3
  },

  tiktok: {
    appId: process.env.TIKTOK_APP_ID,
    appSecret: process.env.TIKTOK_APP_SECRET,
    accessToken: process.env.TIKTOK_ACCESS_TOKEN,
    advertiserIds: process.env.TIKTOK_ADVERTISER_IDS
      ? process.env.TIKTOK_ADVERTISER_IDS.split(',').map(id => id.trim())
      : [],
    apiVersion: 'v1.3',
    // Token صلاحيته سنة كاملة — تنبيه قبل 30 يوم
    tokenAcquiredAt: process.env.TIKTOK_TOKEN_ACQUIRED_AT || null
  },

  paths: {
    products: path.join(__dirname, '../config/products.json'),
    db: path.join(__dirname, '../data/monitor.db'),
    logs: path.join(__dirname, '../logs')
  },

  timezone: 'Africa/Cairo'
};

// التحقق من المتغيرات الأساسية
const required = [
  'META_ACCESS_TOKEN', 'AD_ACCOUNT_IDS',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_USER_CHAT_ID',
  'ANTHROPIC_API_KEY'
];

// TikTok اختياري — لو موجود بيتفعل تلقائياً
if (process.env.TIKTOK_ACCESS_TOKEN) {
  console.log('[Config] ✅ TikTok Ads integration enabled');
} else {
  console.log('[Config] ℹ️  TikTok Ads not configured (optional)');
}

const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ متغيرات البيئة المفقودة: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = config;
