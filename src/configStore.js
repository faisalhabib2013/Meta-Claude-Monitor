const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

// مخزن الإعدادات الديناميكي — المنتجات والحسابات وإعدادات المراقبة في قاعدة البيانات
// التعديلات فورية بدون redeploy وتعيش بعد إعادة التشغيل (على الـ Volume)

const PRODUCTS_PATH = path.join(__dirname, '../config/products.json');
const K_PRODUCTS = 'store:products';
const K_META = 'store:meta_accounts';
const K_TT = 'store:tiktok_advertisers';
const K_MON = 'store:monitor';
const K_USERS = 'store:telegram_users';

function db() { return require('./db'); }

function readJsonState(key) {
  try {
    const v = db().getState(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

// ==================== التهيئة عند بدء التشغيل ====================

function init() {
  try {
    // المنتجات: قاعدة البيانات هي المصدر — أول مرة نأخذها من products.json
    let products = readJsonState(K_PRODUCTS);
    if (!products || !Array.isArray(products)) {
      try { products = require('../config/products.json').products || []; }
      catch { products = []; }
      db().setState(K_PRODUCTS, JSON.stringify(products));
      logger.info(`ConfigStore: seeded ${products.length} products from products.json`);
    }
    syncProductsFile(products);

    // حسابات Meta: أول مرة من .env، بعدها من قاعدة البيانات
    let meta = readJsonState(K_META);
    if (!meta || !Array.isArray(meta)) {
      meta = [...(config.meta.adAccountIds || [])];
      db().setState(K_META, JSON.stringify(meta));
    }
    applyMetaAccounts(meta);

    // حسابات TikTok
    let tt = readJsonState(K_TT);
    if (!tt || !Array.isArray(tt)) {
      tt = [...(config.tiktok.advertiserIds || [])];
      db().setState(K_TT, JSON.stringify(tt));
    }
    applyTiktokAdvertisers(tt);

    // مستخدمو Telegram (المتابعون والمتحكمون)
    let users = readJsonState(K_USERS);
    if (!users || !Array.isArray(users) || users.length === 0) {
      users = [...(config.telegram.chatIds || [])];
      db().setState(K_USERS, JSON.stringify(users));
    }
    applyTelegramUsers(users);

    // إعدادات المراقبة
    const mon = readJsonState(K_MON) || {};
    applyMonitorSettings(mon);

    logger.success(`ConfigStore ready — ${products.length} منتج | Meta: ${meta.length} | TikTok: ${tt.length} | Users: ${users.length}`);
  } catch (err) {
    logger.error('ConfigStore init failed', err);
  }
}

// كتابة products.json + مسح الـ require cache — باقي النظام يقرأ الملف كالمعتاد فيشوف التحديث فوراً
function syncProductsFile(products) {
  try {
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify({ products }, null, 2), 'utf8');
    try { delete require.cache[require.resolve('../config/products.json')]; } catch {}
  } catch (err) {
    logger.error('Failed to sync products.json', err);
  }
}

// تطبيق الحسابات على config في الذاكرة (كل الدورات تقرأ منها مباشرة)
function applyMetaAccounts(list) {
  config.meta.adAccountIds.length = 0;
  config.meta.adAccountIds.push(...list);
}

function applyTiktokAdvertisers(list) {
  if (!config.tiktok.advertiserIds) config.tiktok.advertiserIds = [];
  config.tiktok.advertiserIds.length = 0;
  config.tiktok.advertiserIds.push(...list);
}

function applyMonitorSettings(mon) {
  if (mon.cooldownHours != null) config.monitor.alertCooldownMs = mon.cooldownHours * 60 * 60 * 1000;
  if (mon.bufferPct != null) config.monitor.cppBuffer = mon.bufferPct / 100;
  if (mon.minPurchases != null) config.monitor.minPurchases = mon.minPurchases;
  if (mon.highSpendPct != null) config.monitor.highSpendMultiplier = mon.highSpendPct / 100;
}

// ==================== المنتجات ====================

function getProducts() {
  return readJsonState(K_PRODUCTS) || [];
}

function saveProducts(products) {
  db().setState(K_PRODUCTS, JSON.stringify(products));
  syncProductsFile(products);
}

function addProduct(name, maxCpp) {
  name = String(name).trim();
  maxCpp = Number(maxCpp);
  if (!name) return { ok: false, error: 'اسم المنتج فارغ' };
  if (!maxCpp || maxCpp < 1 || maxCpp > 10000) return { ok: false, error: 'Max CPP غير صالح (1 - 10000)' };

  const products = getProducts();
  if (products.some(p => p.name === name)) {
    return { ok: false, error: `المنتج "${name}" موجود بالفعل — استخدم /edit_cpp لتعديل الحد` };
  }
  products.push({ name, maxCpp });
  saveProducts(products);
  logger.success(`Product added: ${name} (Max CPP: ${maxCpp})`);
  return { ok: true, name, maxCpp, total: products.length };
}

function editCpp(name, maxCpp) {
  name = String(name).trim();
  maxCpp = Number(maxCpp);
  if (!maxCpp || maxCpp < 1 || maxCpp > 10000) return { ok: false, error: 'Max CPP غير صالح (1 - 10000)' };

  const products = getProducts();
  // مطابقة دقيقة أولاً، ثم جزئية
  let product = products.find(p => p.name === name);
  if (!product) product = products.find(p => p.name.includes(name) || name.includes(p.name));
  if (!product) return { ok: false, error: `لم أجد منتجاً باسم "${name}"` };

  const oldCpp = product.maxCpp;
  product.maxCpp = maxCpp;
  saveProducts(products);
  logger.success(`Product CPP updated: ${product.name} ${oldCpp} → ${maxCpp}`);
  return { ok: true, name: product.name, oldCpp, maxCpp };
}

function removeProduct(name) {
  const products = getProducts();
  let product = products.find(p => p.name === name);
  if (!product) product = products.find(p => p.name.includes(name) || name.includes(p.name));
  if (!product) return { ok: false, error: `لم أجد منتجاً باسم "${name}"` };

  const filtered = products.filter(p => p.name !== product.name);
  saveProducts(filtered);
  logger.warn(`Product removed: ${product.name}`);
  return { ok: true, name: product.name, remaining: filtered.length };
}

function findProduct(name) {
  const products = getProducts();
  return products.find(p => p.name === name)
    || products.find(p => (p.aliases || []).includes(name))
    || products.find(p => p.name.includes(name) || name.includes(p.name))
    || null;
}

// ==================== الأسماء البديلة (Aliases) ====================

function addAlias(productQuery, alias) {
  alias = String(alias).trim();
  if (!alias) return { ok: false, error: 'الاسم البديل فارغ' };

  const products = getProducts();
  let product = products.find(p => p.name === productQuery)
    || products.find(p => p.name.includes(productQuery) || productQuery.includes(p.name));
  if (!product) return { ok: false, error: `لم أجد منتجاً باسم "${productQuery}"` };

  if (products.some(p => p.name === alias)) {
    return { ok: false, error: 'الاسم البديل مطابق لاسم منتج موجود بالفعل' };
  }
  const clash = products.find(p => (p.aliases || []).includes(alias));
  if (clash) return { ok: false, error: `الاسم البديل مستخدم بالفعل للمنتج "${clash.name}"` };

  product.aliases = product.aliases || [];
  if (product.aliases.includes(alias)) return { ok: false, error: 'الاسم البديل موجود بالفعل' };

  product.aliases.push(alias);
  saveProducts(products);
  logger.success(`Alias added: "${alias}" → ${product.name}`);
  return { ok: true, name: product.name, alias, aliases: product.aliases };
}

function removeAlias(productQuery, alias) {
  alias = String(alias).trim();
  const products = getProducts();
  let product = products.find(p => p.name === productQuery)
    || products.find(p => p.name.includes(productQuery) || productQuery.includes(p.name));
  if (!product) return { ok: false, error: `لم أجد منتجاً باسم "${productQuery}"` };

  if (!(product.aliases || []).includes(alias)) {
    return { ok: false, error: `"${alias}" ليس اسماً بديلاً للمنتج "${product.name}"` };
  }
  product.aliases = product.aliases.filter(a => a !== alias);
  saveProducts(products);
  logger.warn(`Alias removed: "${alias}" from ${product.name}`);
  return { ok: true, name: product.name, alias, aliases: product.aliases };
}

// ==================== الحسابات ====================

function getAccounts() {
  return {
    meta: readJsonState(K_META) || [],
    tiktok: readJsonState(K_TT) || []
  };
}

function addAccount(platform, id) {
  id = String(id).trim();
  if (!/^\d{5,25}$/.test(id)) return { ok: false, error: 'معرف الحساب غير صالح (أرقام فقط)' };

  if (platform === 'meta') {
    const list = readJsonState(K_META) || [];
    if (list.includes(id)) return { ok: false, error: 'الحساب موجود بالفعل' };
    list.push(id);
    db().setState(K_META, JSON.stringify(list));
    applyMetaAccounts(list);
    logger.success(`Meta account added: ${id}`);
    return { ok: true, platform: 'Meta', id, total: list.length };
  }

  if (platform === 'tiktok') {
    const list = readJsonState(K_TT) || [];
    if (list.includes(id)) return { ok: false, error: 'الحساب موجود بالفعل' };
    list.push(id);
    db().setState(K_TT, JSON.stringify(list));
    applyTiktokAdvertisers(list);
    logger.success(`TikTok advertiser added: ${id}`);
    return { ok: true, platform: 'TikTok', id, total: list.length };
  }

  return { ok: false, error: 'المنصة يجب أن تكون meta أو tiktok' };
}

function removeAccount(platform, id) {
  id = String(id).trim();
  if (platform === 'meta') {
    const list = (readJsonState(K_META) || []).filter(a => a !== id);
    db().setState(K_META, JSON.stringify(list));
    applyMetaAccounts(list);
    logger.warn(`Meta account removed: ${id}`);
    return { ok: true, platform: 'Meta', id, remaining: list.length };
  }
  if (platform === 'tiktok') {
    const list = (readJsonState(K_TT) || []).filter(a => a !== id);
    db().setState(K_TT, JSON.stringify(list));
    applyTiktokAdvertisers(list);
    logger.warn(`TikTok advertiser removed: ${id}`);
    return { ok: true, platform: 'TikTok', id, remaining: list.length };
  }
  return { ok: false, error: 'المنصة يجب أن تكون meta أو tiktok' };
}

// تطبيق قائمة المستخدمين على config (البث يقرأ منها مباشرة)
function applyTelegramUsers(list) {
  config.telegram.chatIds.length = 0;
  config.telegram.chatIds.push(...list.map(String));
}

// ==================== مستخدمو Telegram ====================

function getUsers() {
  return (readJsonState(K_USERS) || []).map(String);
}

function isAuthorized(chatId) {
  return getUsers().includes(String(chatId));
}

function addUser(chatId) {
  chatId = String(chatId).trim();
  if (!/^-?\d{5,15}$/.test(chatId)) return { ok: false, error: 'معرف Telegram غير صالح (أرقام فقط)' };

  const users = getUsers();
  if (users.includes(chatId)) return { ok: false, error: 'المستخدم مسجل بالفعل' };

  users.push(chatId);
  db().setState(K_USERS, JSON.stringify(users));
  applyTelegramUsers(users);
  logger.success(`Telegram user added: ${chatId}`);
  return { ok: true, chatId, total: users.length };
}

function removeUser(chatId) {
  chatId = String(chatId).trim();
  const users = getUsers();
  if (!users.includes(chatId)) return { ok: false, error: 'المستخدم غير مسجل أصلاً' };
  if (users.length <= 1) return { ok: false, error: 'لا يمكن حذف آخر مستخدم — النظام سيفقد كل متابعيه' };

  const filtered = users.filter(u => u !== chatId);
  db().setState(K_USERS, JSON.stringify(filtered));
  applyTelegramUsers(filtered);
  logger.warn(`Telegram user removed: ${chatId}`);
  return { ok: true, chatId, remaining: filtered.length };
}

// ==================== إعدادات المراقبة ====================

const SETTING_DEFS = {
  cooldown: { key: 'cooldownHours', label: 'فترة الانتظار بين التنبيهات', unit: 'ساعة', min: 1, max: 24 },
  buffer: { key: 'bufferPct', label: 'نسبة التنبيه من Max CPP', unit: '%', min: 100, max: 200 },
  min_purchases: { key: 'minPurchases', label: 'حد أدنى مشتريات قبل التنبيه', unit: 'مشترية', min: 1, max: 20 },
  high_spend: { key: 'highSpendPct', label: 'نسبة الإنفاق العالي بدون مبيعات', unit: '%', min: 100, max: 1000 }
};

function setSetting(name, value) {
  const def = SETTING_DEFS[name];
  if (!def) {
    return { ok: false, error: `إعداد غير معروف. المتاح: ${Object.keys(SETTING_DEFS).join(', ')}` };
  }
  value = Number(value);
  if (isNaN(value) || value < def.min || value > def.max) {
    return { ok: false, error: `القيمة يجب أن تكون بين ${def.min} و ${def.max} ${def.unit}` };
  }

  const mon = readJsonState(K_MON) || {};
  mon[def.key] = value;
  db().setState(K_MON, JSON.stringify(mon));
  applyMonitorSettings(mon);
  logger.success(`Setting updated: ${name} = ${value}`);
  return { ok: true, label: def.label, value, unit: def.unit };
}

function getSettingsView() {
  const accounts = getAccounts();
  const products = getProducts();
  return {
    products: products.length,
    metaAccounts: accounts.meta,
    tiktokAdvertisers: accounts.tiktok,
    cooldownHours: config.monitor.alertCooldownMs / 3600000,
    bufferPct: Math.round(config.monitor.cppBuffer * 100),
    minPurchases: config.monitor.minPurchases,
    highSpendPct: Math.round(config.monitor.highSpendMultiplier * 100),
    intervalMin: config.monitor.intervalMs / 60000
  };
}

module.exports = {
  init, getProducts, addProduct, editCpp, removeProduct, findProduct,
  addAlias, removeAlias,
  getAccounts, addAccount, removeAccount,
  getUsers, addUser, removeUser, isAuthorized,
  setSetting, getSettingsView, SETTING_DEFS
};
