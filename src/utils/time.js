const { format, startOfDay, endOfDay } = require('date-fns');
const { toZonedTime, fromZonedTime } = require('date-fns-tz');

const TZ = 'Africa/Cairo';

function nowCairo() {
  return toZonedTime(new Date(), TZ);
}

function todayString() {
  return format(nowCairo(), 'yyyy-MM-dd');
}

function cairoTime() {
  return format(nowCairo(), 'HH:mm');
}

function cairoDateTime() {
  return format(nowCairo(), 'yyyy-MM-dd HH:mm:ss');
}

function formatCairoTime(dateMs) {
  return format(toZonedTime(new Date(dateMs), TZ), 'HH:mm');
}

// هل نحن في نفس اليوم (بتوقيت القاهرة)؟
function isSameCairoDay(date1Ms, date2Ms) {
  const d1 = format(toZonedTime(new Date(date1Ms), TZ), 'yyyy-MM-dd');
  const d2 = format(toZonedTime(new Date(date2Ms), TZ), 'yyyy-MM-dd');
  return d1 === d2;
}

// بداية ونهاية اليوم الحالي بالـ UTC (لحساب فترة الـ insights)
function todayUTCRange() {
  const cairoNow = nowCairo();
  const start = fromZonedTime(startOfDay(cairoNow), TZ);
  const end = fromZonedTime(endOfDay(cairoNow), TZ);
  return { start: start.toISOString(), end: end.toISOString() };
}

// تاريخ الأمس
function yesterdayString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return format(toZonedTime(yesterday, TZ), 'yyyy-MM-dd');
}

// تاريخ قبل N أيام
function daysAgoString(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return format(toZonedTime(d, TZ), 'yyyy-MM-dd');
}

module.exports = {
  nowCairo,
  todayString,
  cairoTime,
  cairoDateTime,
  formatCairoTime,
  isSameCairoDay,
  todayUTCRange,
  yesterdayString,
  daysAgoString,
  TZ
};
