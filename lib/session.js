'use strict';
/** 登录会话：保存、过期静默重登 */

const crypto = require('node:crypto');
const cx = require('./cx');

const TRANSFER_KEY = 'u2oh6Vu^HWe4_AES';

/** 学习通的传输层加密可逆，用来做静默重登录 */
function aesDecrypt(b64) {
  const key = Buffer.from(TRANSFER_KEY, 'utf8');
  const d = crypto.createDecipheriv('aes-128-cbc', key, key);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

function createSessionStore({ store, log }) {
  let session = null;

  function hydrate() {
    const db = store.get();
    if (db.account && db.account.cookies) session = new cx.Session(db.account);
  }

  function persist() {
    const db = store.get();
    db.account = session ? session.toJSON() : null;
    store.save();
  }

  function get() {
    return session;
  }

  function set(s) {
    session = s;
    persist();
  }

  function requireSession() {
    if (!session || !session.loggedIn) throw new Error('NOT_LOGGED_IN');
    return session;
  }

  /** 执行一次需要登录的操作；会话失效时用存着的密码静默重登一次 */
  async function withSession(fn) {
    let s = requireSession();
    try {
      return await fn(s);
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED' && s.encPassword && s.phone) {
        log('warn', '会话失效，尝试静默重新登录');
        try {
          s = new cx.Session({ device: s.device, deviceCode: s.deviceCode, phone: s.phone });
          await s.login(s.phone, aesDecrypt(s.encPassword));
          session = s;
          persist();
          log('ok', '静默重登录成功');
          return await fn(s);
        } catch (e2) {
          session = null;
          persist();
          throw new Error(`会话已失效，请重新登录（${e2.message}）`);
        }
      }
      throw e;
    }
  }

  return { hydrate, persist, get, set, require: requireSession, withSession };
}

module.exports = { createSessionStore, aesDecrypt };
