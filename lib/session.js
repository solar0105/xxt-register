'use strict';
/** 登录会话：按用户隔离，过期静默重登 */

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
  const sessions = new Map(); // uid -> cx.Session | null

  /** 懒加载：第一次用到某个用户时才从他那份数据里恢复会话 */
  function get() {
    const uid = store.currentUid();
    if (!sessions.has(uid)) {
      const db = store.get();
      sessions.set(uid, db.account && db.account.cookies ? new cx.Session(db.account) : null);
    }
    return sessions.get(uid);
  }

  function persist() {
    const db = store.get();
    const s = get();
    db.account = s ? s.toJSON() : null;
    store.save();
  }

  function set(s) {
    sessions.set(store.currentUid(), s);
    persist();
  }

  function clear() {
    sessions.delete(store.currentUid());
    persist();
  }

  function requireSession() {
    const s = get();
    if (!s || !s.loggedIn) throw new Error('NOT_LOGGED_IN');
    return s;
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
          sessions.set(store.currentUid(), s);
          persist();
          log('ok', '静默重登录成功');
          return await fn(s);
        } catch (e2) {
          sessions.set(store.currentUid(), null);
          persist();
          throw new Error(`会话已失效，请重新登录（${e2.message}）`);
        }
      }
      throw e;
    }
  }

  /** 兼容旧调用：现在是懒加载，不需要预热 */
  function hydrate() {}

  /** 某个用户退出登录 / 数据被删时清掉内存里的会话 */
  function forget(uid) {
    sessions.delete(uid);
  }

  return { hydrate, persist, get, set, clear, require: requireSession, withSession, forget };
}

module.exports = { createSessionStore, aesDecrypt };
