const Database = require('better-sqlite3');
const config = require('./config');
const logger = require('./utils/logger');

let db;

function getDb() {
  if (!db) {
    db = new Database(config.paths.db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  const d = getDb();

  // بيانات الأداء اليومي لكل adset
  d.exec(`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      product_name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      adset_id TEXT NOT NULL,
      adset_name TEXT NOT NULL,
      spend REAL DEFAULT 0,
      purchases REAL DEFAULT 0,
      cpp REAL DEFAULT 0,
      max_cpp REAL NOT NULL,
      impressions INTEGER DEFAULT 0,
      frequency REAL DEFAULT 0,
      ctr REAL DEFAULT 0,
      cpm REAL DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      add_to_cart REAL DEFAULT 0,
      checkouts REAL DEFAULT 0,
      lp_views INTEGER DEFAULT 0,
      three_s_plays INTEGER DEFAULT 0,
      thru_plays INTEGER DEFAULT 0,
      hook_rate REAL DEFAULT 0,
      hold_rate REAL DEFAULT 0,
      purchase_roas REAL DEFAULT 0,
      threshold_exceeded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, adset_id)
    )
  `);

  // تتبع التنبيهات المرسلة (لتجنب التكرار)
  d.exec(`
    CREATE TABLE IF NOT EXISTS alert_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      adset_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      reason TEXT
    )
  `);

  // تتبع تجاوز الـ CPP للأيام المتتالية (للتحليل العميق)
  d.exec(`
    CREATE TABLE IF NOT EXISTS consecutive_breaches (
      product_name TEXT NOT NULL,
      date TEXT NOT NULL,
      total_spend REAL,
      total_purchases REAL,
      total_cpp REAL,
      analysis_done INTEGER DEFAULT 0,
      PRIMARY KEY (product_name, date)
    )
  `);

  // حالة النظام (للـ 3-day timer وغيره)
  d.exec(`
    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  logger.success('Database initialized');
}

// ==================== Daily Metrics ====================

function upsertDailyMetrics(date, adsetId, data) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO daily_metrics (
      date, product_name, account_id, campaign_id, campaign_name,
      adset_id, adset_name, spend, purchases, cpp, max_cpp,
      impressions, frequency, ctr, cpm, clicks, add_to_cart,
      checkouts, lp_views, three_s_plays, thru_plays, hook_rate,
      hold_rate, purchase_roas, threshold_exceeded
    ) VALUES (
      @date, @productName, @accountId, @campaignId, @campaignName,
      @adsetId, @adsetName, @spend, @purchases, @cpp, @maxCpp,
      @impressions, @frequency, @ctr, @cpm, @clicks, @addToCart,
      @checkouts, @lpViews, @threeSPlays, @thruPlays, @hookRate,
      @holdRate, @purchaseRoas, @thresholdExceeded
    )
    ON CONFLICT(date, adset_id) DO UPDATE SET
      spend = @spend, purchases = @purchases, cpp = @cpp,
      impressions = @impressions, frequency = @frequency,
      ctr = @ctr, cpm = @cpm, clicks = @clicks,
      add_to_cart = @addToCart, checkouts = @checkouts,
      lp_views = @lpViews, three_s_plays = @threeSPlays,
      thru_plays = @thruPlays, hook_rate = @hookRate,
      hold_rate = @holdRate, purchase_roas = @purchaseRoas,
      threshold_exceeded = @thresholdExceeded
  `);
  return stmt.run({ date, adsetId, ...data });
}

function getDailyMetricsByProduct(productName, fromDate, toDate) {
  const d = getDb();
  return d.prepare(`
    SELECT * FROM daily_metrics
    WHERE product_name = ? AND date BETWEEN ? AND ?
    ORDER BY date DESC, campaign_name, adset_name
  `).all(productName, fromDate, toDate);
}

function getAllProductsToday(date) {
  const d = getDb();
  return d.prepare(`
    SELECT product_name,
           SUM(spend) as total_spend,
           SUM(purchases) as total_purchases,
           MAX(max_cpp) as max_cpp,
           COUNT(DISTINCT campaign_id) as campaign_count,
           COUNT(DISTINCT adset_id) as adset_count
    FROM daily_metrics
    WHERE date = ?
    GROUP BY product_name
  `).all(date);
}

function getAllAdsetMetricsToday(date) {
  const d = getDb();
  return d.prepare(`
    SELECT * FROM daily_metrics WHERE date = ?
    ORDER BY product_name, campaign_name, adset_name
  `).all(date);
}

// ==================== Alert Log ====================

// هل تم إرسال تنبيه لهذا الـ adset خلال الـ cooldown؟
function wasAlertedRecently(adsetId, productName, cooldownMs) {
  const d = getDb();
  const cutoff = Date.now() - cooldownMs;
  const row = d.prepare(`
    SELECT id FROM alert_log
    WHERE adset_id = ? AND product_name = ? AND alert_type = 'hourly' AND sent_at > ?
    ORDER BY sent_at DESC LIMIT 1
  `).get(adsetId, productName, cutoff);
  return !!row;
}

// هل تم إرسال تنبيه لهذا المنتج في اليوم الحالي؟ (أول تنبيه في اليوم فقط)
function wasAlertedToday(adsetId, productName, todayDate) {
  const d = getDb();
  const row = d.prepare(`
    SELECT id FROM alert_log
    WHERE adset_id = ? AND product_name = ? AND alert_type = 'hourly'
    AND date(sent_at/1000, 'unixepoch') = ?
    LIMIT 1
  `).get(adsetId, productName, todayDate);
  return !!row;
}

function logAlert(productName, adsetId, alertType, reason) {
  const d = getDb();
  d.prepare(`
    INSERT INTO alert_log (product_name, adset_id, alert_type, sent_at, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(productName, adsetId, alertType, Date.now(), reason || null);
}

// ==================== Consecutive Breaches ====================

function recordBreach(productName, date, totalSpend, totalPurchases, totalCpp) {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO consecutive_breaches
    (product_name, date, total_spend, total_purchases, total_cpp, analysis_done)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(productName, date, totalSpend, totalPurchases, totalCpp);
}

function getRecentBreaches(productName, days = 2) {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM consecutive_breaches
    WHERE product_name = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(productName, days);
  return rows;
}

function markAnalysisDone(productName, date) {
  const d = getDb();
  d.prepare(`
    UPDATE consecutive_breaches SET analysis_done = 1
    WHERE product_name = ? AND date = ?
  `).run(productName, date);
}

function getProductsNeedingAnalysis(today, yesterday) {
  const d = getDb();
  // منتجات تجاوزت الـ CPP يومين متتاليين ولم يتم تحليلها
  return d.prepare(`
    SELECT b1.product_name, b1.date as today_date, b1.total_cpp,
           b2.date as yesterday_date, b2.total_cpp as yesterday_cpp
    FROM consecutive_breaches b1
    JOIN consecutive_breaches b2
      ON b1.product_name = b2.product_name
      AND b1.date = ? AND b2.date = ?
    WHERE b1.analysis_done = 0
  `).all(today, yesterday);
}

// ==================== System State ====================

function getState(key, defaultValue = null) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM system_state WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setState(key, value) {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(key, String(value));
}

module.exports = {
  getDb,
  upsertDailyMetrics,
  getDailyMetricsByProduct,
  getAllProductsToday,
  getAllAdsetMetricsToday,
  wasAlertedRecently,
  wasAlertedToday,
  logAlert,
  recordBreach,
  getRecentBreaches,
  markAnalysisDone,
  getProductsNeedingAnalysis,
  getState,
  setState
};
