/* 基础：工具函数 / 按需加载 / 网络 / 坐标 */
'use strict';
/* 学习通签到助手 · 前端 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const S = {
  tab: 'sign',
  state: null,
  busy: false,
  scanned: [],
  tempPoint: null, // { lat, lng, address, datum }
  infoCache: {},
  map: null,
  mapMarker: null,
  mapContainer: null,
  datum: 'bd09',
  placeId: null, // 当前选中的签到地点
  lastFix: null, // 上次定位成功的位置（GCJ-02），用来下次直接开在这里
  loginMode: 'pwd', // 'pwd' | 'qr'
  qrImage: null,
  qrTimer: null,
  allActivities: null,
};

// 拿不到任何位置时的兜底中心：郑州市中心。
// 只是起始视图，拖一下就行；一旦保存过地点或定位成功，就不会再用它。
const DEFAULT_CENTER = [34.7466, 113.6254];
// ---------------------------------------------------------------- 按需加载

/**
 * 首屏只加载 app.js（34KB）。
 * Leaflet(147KB) 和二维码库(57KB) 都改成用到才拉，校园网差的时候不至于白屏。
 */
const _loaded = new Set();
const _pending = new Map();
function loadScript(src) {
  if (_loaded.has(src)) return Promise.resolve();
  if (_pending.has(src)) return _pending.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      _loaded.add(src);
      _pending.delete(src);
      resolve();
    };
    s.onerror = () => {
      _pending.delete(src);
      reject(new Error('资源加载失败：' + src));
    };
    document.head.appendChild(s);
  });
  _pending.set(src, p);
  return p;
}
function loadCSS(href) {
  if (_loaded.has(href)) return Promise.resolve();
  if (_pending.has(href)) return _pending.get(href);
  const p = new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = () => {
      _loaded.add(href);
      _pending.delete(href);
      resolve();
    };
    l.onerror = () => {
      _pending.delete(href);
      resolve();
    };
    document.head.appendChild(l);
  });
  _pending.set(href, p);
  return p;
}

async function ensureLeaflet() {
  if (typeof L !== 'undefined') return true;
  await loadCSS('/vendor/leaflet.css');
  await loadScript('/vendor/leaflet.js');
  return typeof L !== 'undefined';
}

async function ensureQR() {
  if (typeof qrcode !== 'undefined') return true;
  await loadScript('/vendor/qrcode.js');
  return typeof qrcode !== 'undefined';
}
// ---------------------------------------------------------------- 网络

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {} };
  if (opts.raw) {
    init.body = opts.raw;
    init.method = opts.method || 'POST';
  } else if (opts.body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, init);
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`服务端返回异常：${text.slice(0, 100)}`);
  }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

let toastTimer = null;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
}

async function guard(fn, btn) {
  if (S.busy) return;
  S.busy = true;
  const old = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>处理中';
  }
  try {
    await fn();
  } catch (e) {
    toast(e.message || '操作失败', 'bad');
  } finally {
    S.busy = false;
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }
}
// ---------------------------------------------------------------- 坐标

const X_PI = (Math.PI * 3000) / 180;
const EE = 0.00669342162296594323;
const A = 6378245;

const outOfChina = (lat, lng) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;

function tLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}
function tLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}

function wgsToGcj(lat, lng) {
  if (outOfChina(lat, lng)) return [lat, lng];
  let dLat = tLat(lng - 105, lat - 35);
  let dLng = tLng(lng - 105, lat - 35);
  const rad = (lat / 180) * Math.PI;
  let magic = Math.sin(rad);
  magic = 1 - EE * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sq)) * Math.PI);
  dLng = (dLng * 180) / ((A / sq) * Math.cos(rad) * Math.PI);
  return [lat + dLat, lng + dLng];
}

function gcjToWgs(lat, lng) {
  if (outOfChina(lat, lng)) return [lat, lng];
  const [gLat, gLng] = wgsToGcj(lat, lng);
  return [lat * 2 - gLat, lng * 2 - gLng];
}

function gcjToBd(lat, lng) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const t = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return [z * Math.sin(t) + 0.006, z * Math.cos(t) + 0.003];
}

function bdToGcj(lat, lng) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const t = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return [z * Math.sin(t), z * Math.cos(t)];
}

/** 把某个基准的坐标转成地图基准(GCJ-02) */
function toGcj(lat, lng, datum) {
  if (datum === 'wgs84') return wgsToGcj(lat, lng);
  if (datum === 'bd09') return bdToGcj(lat, lng);
  return [lat, lng];
}
/** 把地图基准(GCJ-02)转成目标基准 */
function fromGcj(lat, lng, datum) {
  if (datum === 'wgs84') return gcjToWgs(lat, lng);
  if (datum === 'bd09') return gcjToBd(lat, lng);
  return [lat, lng];
}

/** 浏览器定位。注意：只在 HTTPS 或 localhost 下可用，普通 http 会被浏览器拒绝 */
function getBrowserFix() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('这个浏览器不支持定位'));
      return;
    }
    if (!window.isSecureContext) {
      reject(
        new Error(
          '浏览器只在 HTTPS 或 localhost 下允许定位。当前是普通 http，请直接拖动地图选点（或手填经纬度）',
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      (err) => {
        const map = {
          1: '你拒绝了定位权限，去浏览器设置里允许后重试',
          2: '定位信号不可用（室内／没开 GPS）',
          3: '定位超时，再试一次',
        };
        reject(new Error(map[err.code] || '定位失败'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const fmtTime = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  return `${Math.round(m / 60)} 小时前`;
};
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
