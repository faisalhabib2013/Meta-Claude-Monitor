const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const DELAY_MS = 200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getHeaders() {
  return {
    'Access-Token': config.tiktok.accessToken,
    'Content-Type': 'application/json'
  };
}

async function tiktokGet(path, params = {}) {
  await sleep(DELAY_MS);
  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      headers: getHeaders(),
      params,
      timeout: 30000
    });
    if (res.data.code !== 0) {
      throw new Error(`TikTok API [${res.data.code}]: ${res.data.message}`);
    }
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    if (err.response?.data?.code === 40101) throw new Error('TIKTOK_TOKEN_EXPIRED');
    throw new Error(`TikTok GET ${path}: ${msg}`);
  }
}

async function tiktokPost(path, body = {}) {
  await sleep(DELAY_MS);
  try {
    const res = await axios.post(`${BASE_URL}${path}`, body, {
      headers: getHeaders(),
      timeout: 30000
    });
    if (res.data.code !== 0) {
      throw new Error(`TikTok API [${res.data.code}]: ${res.data.message}`);
    }
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    if (err.response?.data?.code === 40101) throw new Error('TIKTOK_TOKEN_EXPIRED');
    throw new Error(`TikTok POST ${path}: ${msg}`);
  }
}

// جلب كل الصفحات تلقائياً
async function tiktokGetAllPages(path, params = {}) {
  const results = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const data = await tiktokGet(path, { ...params, page, page_size: pageSize });
    const list = data.data?.list || [];
    const pageInfo = data.data?.page_info || {};

    results.push(...list);

    const total = pageInfo.total_number || 0;
    if (results.length >= total || list.length === 0) break;
    page++;
  }

  return results;
}

// التحقق من صلاحية الـ Token
async function checkTiktokToken() {
  try {
    await tiktokGet('/oauth2/advertiser/get/', {
      app_id: config.tiktok.appId,
      secret: config.tiktok.appSecret
    });
    return { valid: true };
  } catch (err) {
    if (err.message === 'TIKTOK_TOKEN_EXPIRED') return { valid: false, expired: true };
    return { valid: false, error: err.message };
  }
}

module.exports = { tiktokGet, tiktokPost, tiktokGetAllPages, checkTiktokToken };
