'use strict';
/* 极简 JSON 持久化（原子写），单进程使用 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = {
  account: null, // { phone, encPassword, cookies, user, deviceCode, device }
  places: [], // { id, name, lat, lng, address }
  face: { objectId: null, source: null, updatedAt: 0 },
  plans: [], // { id, name, enabled, time, days, courseId, placeId, windowMinutes, useFace, lastRunKey }
  autosign: { enabled: false, lastTick: 0 },
  courses: [], // 缓存
};

let db = null;
let writeTimer = null;

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (db) return db;
  ensureDir();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = { ...structuredClone(EMPTY), ...parsed };
    db.places ||= [];
    db.plans ||= [];
    delete db.logs; // 老版本存过日志，加载时顺手清掉
    if (!db.face) db.face = { objectId: null, source: null, updatedAt: 0 };
    if (!db.autosign) db.autosign = { enabled: false, lastTick: 0 };
  } catch {
    db = structuredClone(EMPTY);
  }
  return db;
}

function persistNow() {
  if (!db) return;
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('[store] 写入失败', e.message);
  }
}

function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    persistNow();
  }, 120);
  writeTimer.unref?.();
}

function get() {
  return load();
}

/**
 * 日志只往控制台打，不再存进 db.json。
 * 服务器上看日志用 systemctl/journalctl 就够了，没必要占磁盘和内存。
 */
function addLog(level, text) {
  const tag = { info: 'INFO', warn: 'WARN', error: 'ERR ', ok: 'OK  ' }[level] || 'INFO';
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${tag} ${text}`);
}

function clearLogs() {
  /* 已不存日志，保留此函数仅为兼容调用处 */
}

module.exports = { get, save, persistNow, addLog, clearLogs, DB_FILE };
