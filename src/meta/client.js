const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const { baseUrl, apiVersion, accessToken } = config.meta;

// تأخير بين الطلبات لتجنب rate limiting
const DELAY_MS = 150;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// طلب GET أساسي
async function metaGet(path, params = {}) {
  await sleep(DELAY_MS);
  try {
    const response = await axios.get(`${baseUrl}/${apiVersion}${path}`, {
      params: { access_token: accessToken, ...params },
      timeout: 30000
    });
    return response.data;
  } catch (err) {
    const apiErr = err.response?.data?.error;
    if (apiErr) {
      logger.error(`Meta API Error [${apiErr.code}] ${path}`, apiErr.message);
      // Token منتهي
      if (apiErr.code === 190) throw new Error('META_TOKEN_EXPIRED');
    }
    throw err;
  }
}

// طلب POST أساسي (للتعديلات على الحملات)
async function metaPost(path, data = {}) {
  await sleep(DELAY_MS);
  try {
    const response = await axios.post(
      `${baseUrl}/${apiVersion}${path}`,
      { access_token: accessToken, ...data },
      { timeout: 30000 }
    );
    return response.data;
  } catch (err) {
    const apiErr = err.response?.data?.error;
    if (apiErr) {
      logger.error(`Meta API POST Error [${apiErr.code}] ${path}`, apiErr.message);
    }
    throw err;
  }
}

// جلب كل الصفحات (pagination)
async function metaGetAll(path, params = {}) {
  const results = [];
  let data = await metaGet(path, params);

  results.push(...(data.data || []));

  while (data.paging?.next) {
    await sleep(DELAY_MS);
    const nextResponse = await axios.get(data.paging.next, { timeout: 30000 });
    data = nextResponse.data;
    results.push(...(data.data || []));
  }

  return results;
}

// التحقق من صلاحية الـ Token وتاريخ انتهائه
async function checkTokenValidity() {
  try {
    const data = await metaGet('/debug_token', {
      input_token: accessToken,
      access_token: `${config.meta.appId}|${config.meta.appSecret}`
    });

    const tokenData = data.data;
    if (!tokenData?.is_valid) {
      return { valid: false, daysLeft: 0 };
    }

    const expiresAt = tokenData.expires_at;
    if (!expiresAt || expiresAt === 0) {
      // Token لا ينتهي (System User Token)
      return { valid: true, daysLeft: 999, neverExpires: true };
    }

    const now = Math.floor(Date.now() / 1000);
    const daysLeft = Math.floor((expiresAt - now) / 86400);
    return { valid: true, daysLeft, expiresAt };
  } catch (err) {
    logger.error('Token validation failed', err);
    return { valid: false, daysLeft: 0, error: err.message };
  }
}

module.exports = { metaGet, metaPost, metaGetAll, checkTokenValidity };
