'use strict';
/*
 * 每用户一份 JSON（原子写）。
 *
 * 关键设计：用 AsyncLocalStorage 把「当前请求属于谁」绑到调用链上，
 * 于是路由代码里的 store.get() / store.save() 一行都不用改，
 * 就自动落到当前用户的数据库。并发请求之间互不干扰。
 */

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const LEGACY_FILE = path.join(DATA_DIR, 'db.json');

const als = new AsyncLocalStorage();
const contexts = new Map(); // uid -> ctx

const EMPTY = {
  account: null, // { phone, encPassword, cookies, user, deviceCode, device }
  places: [], // { id, name, lat, lng, address }
  face: { objectId: null, source: null, updatedAt: 0 },
  plans: [], // { id, name, enabled, time, days, courseId, placeId, windowMinutes, useFace, lastRunKey }
  autosign: { enabled: false, lastTick: 0 },
  courses: [],
};

const blank = () => structuredClone(EMPTY);

function ensureDirs() {
  fs.mkdirSync(USERS_DIR, { recursive: true });
}

const userFile = (uid) => path.join(USERS_DIR, `${uid}.json`);

function normalize(raw) {
  const db = { ...blank(), ...(raw || {}) };
  if (!Array.isArray(db.places)) db.places = [];
  if (!Array.isArray(db.plans)) db.plans = [];
  if (!Array.isArray(db.courses)) db.courses = [];
  delete db.logs;
  if (!db.face) db.face = { objectId: null, source: null, updatedAt: 0 };
  if (!db.autosign) db.autosign = { enabled: false, lastTick: 0 };
  return db;
}

/**
 * 老版本是单文件 data/db.json，所有数据混在一起。
 * 升级后第一个创建的用户继承它，然后改名归档，避免重复认领。
 */
function claimLegacy() {
  try {
    if (!fs.existsSync(LEGACY_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8').replace(/^\uFEFF/, ''));
    fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated');
    console.log('[store] 已把旧的 db.json 迁移给第一个用户');
    return normalize(raw);
  } catch (e) {
    console.error('[store] 旧数据迁移失败：', e.message);
    return null;
  }
}

function createContext(uid) {
  ensureDirs();
  const file = userFile(uid);
  let db;
  if (fs.existsSync(file)) {
    try {
      db = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      db = blank();
    }
  } else {
    db = claimLegacy() || blank();
  }

  let timer = null;
  const flush = () => {
    timer = null;
    try {
      ensureDirs();
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('[store] 写入失败：', e.message);
    }
  };
  const save = () => {
    if (timer) return;
    timer = setTimeout(flush, 120);
    timer.unref?.();
  };

  const ctx = { uid, db, save, flush };
  contexts.set(uid, ctx);
  // 首次创建必须立刻写盘：否则 exists(uid) 为假，
  // 下一个请求会把同一个访客当成陌生人，又要一次口令。
  if (!fs.existsSync(file)) flush();
  return ctx;
}

const ensure = (uid) => contexts.get(uid) || createContext(uid);

/** 在某个用户的上下文里执行 fn（异步安全） */
function runWith(uid, fn) {
  return als.run(ensure(uid), fn);
}

function current() {
  const c = als.getStore();
  if (!c) throw new Error('当前请求没有用户上下文（store.runWith 未包裹）');
  return c;
}

function currentUid() {
  return current().uid;
}

function get() {
  return current().db;
}

function save() {
  current().save();
}

/** 退出前把所有用户未落盘的数据写干净 */
function persistNow() {
  for (const ctx of contexts.values()) ctx.flush();
}

function exists(uid) {
  if (!uid || !/^[a-f0-9]{16,32}$/.test(uid)) return false;
  return fs.existsSync(userFile(uid));
}

function listUsers() {
  ensureDirs();
  return fs
    .readdirSync(USERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));
}

/** 只给排查用：某个用户数据的只读快照 */
function peek(uid) {
  ensureDirs();
  try {
    return normalize(JSON.parse(fs.readFileSync(userFile(uid), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * 日志只往控制台打。
 * 服务器上看日志用 systemctl/journalctl 就够了，没必要占磁盘和内存。
 */
function addLog(level, text) {
  const tag = { info: 'INFO', warn: 'WARN', error: 'ERR ', ok: 'OK  ' }[level] || 'INFO';
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${tag} ${text}`);
}

function clearLogs() {
  /* 已不存日志，保留此函数仅为兼容调用处 */
}

module.exports = {
  get,
  save,
  persistNow,
  addLog,
  clearLogs,
  runWith,
  currentUid,
  ensure,
  exists,
  listUsers,
  peek,
  DATA_DIR,
  USERS_DIR,
};
