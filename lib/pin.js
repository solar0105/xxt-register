'use strict';
/** 访问口令闸门：校验 + 防爆破 */

const { parseCookies, clientIP } = require('./http');

const WINDOW_MS = 10 * 60 * 1000; // 统计窗口
const MAX_FAILS = 8; // 窗口内允许的失败次数
const LOCK_MS = 15 * 60 * 1000; // 锁定时长

function createPinGate(pin) {
  const fails = new Map(); // ip -> { count, since, until }

  function blocked(req) {
    if (!pin) return false;
    const rec = fails.get(clientIP(req));
    return !!(rec && rec.until > Date.now());
  }

  function check(req, url) {
    if (!pin) return true;
    const ip = clientIP(req);
    const now = Date.now();
    const rec = fails.get(ip) || { count: 0, since: now, until: 0 };

    if (rec.until > now) return false;
    if (rec.until && rec.until <= now) {
      rec.count = 0;
      rec.until = 0;
      rec.since = now;
    }

    if (parseCookies(req).cxpin === pin || url.searchParams.get('pin') === pin) {
      fails.delete(ip);
      return true;
    }

    if (now - rec.since > WINDOW_MS) {
      rec.count = 0;
      rec.since = now;
    }
    rec.count += 1;
    if (rec.count >= MAX_FAILS) rec.until = now + LOCK_MS;
    fails.set(ip, rec);
    return false;
  }

  return { check, blocked, enabled: !!pin, pin };
}

module.exports = { createPinGate };
