const { format } = require('date-fns');
const { toZonedTime } = require('date-fns-tz');

const TZ = 'Africa/Cairo';

function timestamp() {
  const now = toZonedTime(new Date(), TZ);
  return format(now, 'yyyy-MM-dd HH:mm:ss');
}

const logger = {
  info: (msg, data) => {
    const log = `[${timestamp()}] ℹ️  ${msg}`;
    console.log(data ? `${log}` : log, data || '');
  },
  success: (msg, data) => {
    const log = `[${timestamp()}] ✅ ${msg}`;
    console.log(data ? `${log}` : log, data || '');
  },
  warn: (msg, data) => {
    const log = `[${timestamp()}] ⚠️  ${msg}`;
    console.warn(data ? `${log}` : log, data || '');
  },
  error: (msg, err) => {
    console.error(`[${timestamp()}] ❌ ${msg}`, err?.message || err || '');
    if (err?.stack) console.error(err.stack);
  },
  alert: (msg, data) => {
    const log = `[${timestamp()}] 🚨 ${msg}`;
    console.log(data ? `${log}` : log, data || '');
  }
};

module.exports = logger;
