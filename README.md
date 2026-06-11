# Meta Ads CPP Monitor 🚀

نظام مراقبة تلقائية لـ CPP مع تنبيهات Telegram وتحليل AI.

## الخطوات للـ Deploy على Railway

### 1. إنشاء Telegram Bot
1. افتح @BotFather على Telegram
2. ابعت `/newbot` وتابع الخطوات
3. احتفظ بالـ **Bot Token**
4. ابعت `/start` للبوت لتعرف الـ **Chat ID** بتاعك

### 2. احصل على Anthropic API Key
- من: https://console.anthropic.com/account/keys

### 3. أضف قيم الـ .env
افتح ملف `.env` وأكمل:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_CHAT_ID=...
TELEGRAM_MEDIA_BUYER_CHAT_ID=...
ANTHROPIC_API_KEY=...
```

### 4. تحديث قائمة المنتجات
افتح `config/products.json` وعدل الـ maxCpp لكل منتج.

### 5. الـ Deploy على Railway
```bash
# من Railway Dashboard:
# New Project → Deploy from GitHub
# أو
railway login
railway init
railway up
```

**⚠️ مهم:** أضف كل متغيرات `.env` في Railway Variables.

---

## هيكل المشروع

```
src/
├── index.js          ← نقطة البداية
├── config.js         ← الإعدادات
├── scheduler.js      ← جدولة المهام
├── cppEngine.js      ← محرك الفحص والتنبيهات
├── db.js             ← قاعدة البيانات SQLite
├── meta/             ← Meta Ads API
├── telegram/         ← Telegram Bot
├── ai/               ← تحليلات Claude
└── utils/            ← أدوات مساعدة
```

## الأوامر على Telegram
- `/start` - معرفة الـ Chat ID
- `/status` - حالة النظام وأداء اليوم

## التكلفة الشهرية
- Railway: ~$5
- Claude API: ~$0.70
- **الإجمالي: ~$6/شهر**
