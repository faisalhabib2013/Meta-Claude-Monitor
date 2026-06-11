const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

// JSON file بدل SQLite — لا يحتاج native compilation
const DB_PATH = config.paths.db.replace('.db', '.json');

let cache = null;

// ==================== Core ====================

function getDb() {
  if (cache) return cache;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    if (fs.existsSync(DB_PATH)) {
      cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } else {
      cache = createEmpty();
      saveToFile();
    }
    logger.success('Database ready (JSON storage)');
  } catch (err) {
    logger.error('DB load failed, starting fresh', err);
    cache = createEmpty();
    saveToFile();
  }
  return cache;
}

function createEmpty() {
  return {
    daily_metrics: {},        // "date:adsetId" → row object
    alert_log: [],            // array of alert records
    consecutive_breaches: {}, // "productName:date" → breach object
    system_state: {}          // key → string value
  };
}

function saveToFile() {
  try {
    const db = cache || createEmpty();
    fs.writeFileSync(DB_PATH, JSON.stringify(db), 'utf8');
  } catch (err) {
    logger.error('DB save failed', err);
  }
}

// تنفيذ mutation وحفظ فوري
function mutate(fn) {
  const db = getDb();
  fn(db);
  saveToFile();
}

// ==================== Daily Metrics ====================

function upsertDailyMetrics(date, adsetId, data) {
  const key = `${date}:${adsetId}`;
  mutate(db => {
    db.daily_metrics[key] = {
      date,
      adset_id: adsetId,
      product_name: data.productName,
      account_id: data.accountId,
      campaign_id: data.campaignId,
      campaign_name: data.campaignName,
      adset_name: data.adsetName,
      spend: data.spend || 0,
      purchases: data.purchases || 0,
      cpp: data.cpp || 0,
      max_cpp: data.maxCpp || 0,
      impressions: data.impressions || 0,
      frequency: data.frequency || 0,
      ctr: data.ctr || 0,
      cpm: data.cpm || 0,
      clicks: data.clicks || 0,
      add_to_cart: data.addToCart || 0,
      checkouts: data.checkouts || 0,
      lp_views: data.lpViews || 0,
      three_s_plays: data.threeSPlays || 0,
      thru_plays: data.thruPlays || 0,
      hook_rate: data.hookRate || 0,
      hold_rate: data.holdRate || 0,
      purchase_roas: data.purchaseRoas || 0,
      threshold_exceeded: data.thresholdExceeded || 0
    };
  });
}

function getDailyMetricsByProduct(productName, fromDate, toDate) {
  const db = getDb();
  return Object.values(db.daily_metrics)
    .filter(r => r.product_name === productName && r.date >= fromDate && r.date <= toDate)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function getAllProductsToday(date) {
  const db = getDb();
  const byProduct = {};

  for (const row of Object.values(db.daily_metrics)) {
    if (row.date !== date) continue;
    if (!byProduct[row.product_name]) {
      byProduct[row.product_name] = {
        product_name: row.product_name,
        total_spend: 0,
        total_purchases: 0,
        max_cpp: row.max_cpp,
        _campaigns: new Set(),
        _adsets: new Set()
      };
    }
    const p = byProduct[row.product_name];
    p.total_spend += row.spend;
    p.total_purchases += row.purchases;
    p._campaigns.add(row.campaign_id);
    p._adsets.add(row.adset_id);
  }

  return Object.values(byProduct).map(p => ({
    product_name: p.product_name,
    total_spend: p.total_spend,
    total_purchases: p.total_purchases,
    max_cpp: p.max_cpp,
    campaign_count: p._campaigns.size,
    adset_count: p._adsets.size
  }));
}

function getAllAdsetMetricsToday(date) {
  const db = getDb();
  return Object.values(db.daily_metrics)
    .filter(r => r.date === date)
    .sort((a, b) => {
      const pn = a.product_name.localeCompare(b.product_name);
      if (pn !== 0) return pn;
      const cn = a.campaign_name.localeCompare(b.campaign_name);
      if (cn !== 0) return cn;
      return a.adset_name.localeCompare(b.adset_name);
    });
}

// ==================== Alert Log ====================

function wasAlertedRecently(adsetId, productName, cooldownMs) {
  const db = getDb();
  const cutoff = Date.now() - cooldownMs;
  return db.alert_log.some(r =>
    r.adset_id === adsetId &&
    r.product_name === productName &&
    r.alert_type === 'hourly' &&
    r.sent_at > cutoff
  );
}

function wasAlertedToday(adsetId, productName, todayDate) {
  const db = getDb();
  return db.alert_log.some(r => {
    if (r.adset_id !== adsetId || r.product_name !== productName || r.alert_type !== 'hourly') return false;
    const d = new Date(r.sent_at).toISOString().split('T')[0];
    return d === todayDate;
  });
}

function logAlert(productName, adsetId, alertType, reason) {
  mutate(db => {
    db.alert_log.push({
      id: db.alert_log.length + 1,
      product_name: productName,
      adset_id: adsetId,
      alert_type: alertType,
      sent_at: Date.now(),
      reason: reason || null
    });
    // الاحتفاظ بآخر 500 تنبيه فقط
    if (db.alert_log.length > 500) db.alert_log = db.alert_log.slice(-500);
  });
}

// هل تم إرسال تنبيه Scale لهذا الـ adset خلال الـ cooldown؟
function wasScaleAlertedRecently(adsetId, productName, cooldownMs) {
  const db = getDb();
  const cutoff = Date.now() - cooldownMs;
  return db.alert_log.some(r =>
    r.adset_id === adsetId &&
    r.product_name === productName &&
    r.alert_type === 'scale' &&
    r.sent_at > cutoff
  );
}

// جلب ملخص المنتجات ليوم معين (للمقارنة في التقرير)
function getProductSummaryForDate(date) {
  const db = getDb();
  const byProduct = {};
  for (const row of Object.values(db.daily_metrics)) {
    if (row.date !== date) continue;
    if (!byProduct[row.product_name]) {
      byProduct[row.product_name] = { spend: 0, purchases: 0, max_cpp: row.max_cpp };
    }
    byProduct[row.product_name].spend += row.spend;
    byProduct[row.product_name].purchases += row.purchases;
  }
  return Object.entries(byProduct).map(([name, d]) => ({
    product_name: name,
    total_spend: d.spend,
    total_purchases: d.purchases,
    cpp: d.purchases > 0 ? d.spend / d.purchases : 0,
    max_cpp: d.max_cpp
  }));
}

// ==================== Consecutive Breaches ====================

function recordBreach(productName, date, totalSpend, totalPurchases, totalCpp) {
  const key = `${productName}:${date}`;
  mutate(db => {
    db.consecutive_breaches[key] = {
      product_name: productName, date,
      total_spend: totalSpend, total_purchases: totalPurchases,
      total_cpp: totalCpp, analysis_done: 0
    };
  });
}

function getRecentBreaches(productName, days = 2) {
  const db = getDb();
  return Object.values(db.consecutive_breaches)
    .filter(r => r.product_name === productName)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
}

function markAnalysisDone(productName, date) {
  const key = `${productName}:${date}`;
  mutate(db => {
    if (db.consecutive_breaches[key]) db.consecutive_breaches[key].analysis_done = 1;
  });
}

function getProductsNeedingAnalysis(today, yesterday) {
  const db = getDb();
  const results = [];
  const productNames = [...new Set(Object.values(db.consecutive_breaches).map(r => r.product_name))];

  for (const productName of productNames) {
    const t = db.consecutive_breaches[`${productName}:${today}`];
    const y = db.consecutive_breaches[`${productName}:${yesterday}`];
    if (t && y && !t.analysis_done) {
      results.push({
        product_name: productName, today_date: today,
        total_cpp: t.total_cpp, yesterday_date: yesterday, yesterday_cpp: y.total_cpp
      });
    }
  }
  return results;
}

// ==================== System State ====================

function getState(key, defaultValue = null) {
  const db = getDb();
  return db.system_state[key] !== undefined ? db.system_state[key] : defaultValue;
}

function setState(key, value) {
  mutate(db => { db.system_state[key] = String(value); });
}

module.exports = {
  getDb, upsertDailyMetrics, getDailyMetricsByProduct,
  getAllProductsToday, getAllAdsetMetricsToday,
  wasAlertedRecently, wasAlertedToday, wasScaleAlertedRecently,
  logAlert, recordBreach, getRecentBreaches, markAnalysisDone,
  getProductsNeedingAnalysis, getState, setState,
  getProductSummaryForDate
};
