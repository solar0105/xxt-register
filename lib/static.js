'use strict';
/*
 * 静态资源层：gzip/brotli 压缩 + ETag/304 + 强缓存
 *
 * 两个目标：
 *   1. 别人访问更快 —— 传输体积压到 1/4 左右，二次访问直接 304
 *   2. 改代码更轻松 —— 前端按模块拆成小文件，服务端在运行时按 manifest 拼成一份
 *
 * 不做构建：进程内缓存，源文件改了 mtime 变、ETag 跟着变，自动失效。
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);
// 带 hash 或版本号的第三方库，可以放心长缓存
const IMMUTABLE = /^\/vendor\//;

/** 内存缓存：key = 逻辑路径，value = { etag, raw, gzip, br } */
const cache = new Map();
let cacheVersion = '';

function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (ae.includes('br')) return 'br';
  if (ae.includes('gzip')) return 'gzip';
  return 'identity';
}

function compress(buf, ext) {
  if (!COMPRESSIBLE.has(ext)) return { gzip: null, br: null };
  return {
    gzip: zlib.gzipSync(buf, { level: 6 }),
    br: zlib.brotliCompressSync(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }),
  };
}

/** 把前端模块按 manifest 顺序拼成一份，省掉 N 个请求 */
function buildBundle(publicDir, log) {
  const dir = path.join(publicDir, 'js');
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error(`js/manifest.json 解析失败：${e.message}`);
  }
  const files = manifest.files || [];
  if (!files.length) return null;

  const parts = [];
  const stamps = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    let st;
    try {
      st = fs.statSync(fp);
    } catch {
      throw new Error(`js/manifest.json 里列了 ${f}，但文件不存在`);
    }
    stamps.push(`${f}:${st.size}:${st.mtimeMs}`);
    parts.push(`\n/* ==================== ${f} ==================== */\n`);
    parts.push(fs.readFileSync(fp, 'utf8'));
  }
  if (log) log('info', `前端模块已合包：${files.length} 个`);
  return { body: Buffer.from(parts.join(''), 'utf8'), sig: crypto.createHash('sha1').update(stamps.join('|')).digest('hex') };
}

function makeEntry(file, body) {
  const ext = path.extname(file).toLowerCase();
  const { gzip, br } = compress(body, ext);
  return {
    etag: '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 20) + '"',
    raw: body,
    gzip,
    br,
    type: MIME[ext] || 'application/octet-stream',
  };
}

function createStaticServer({ publicDir, log }) {
  // 启动时先合一次包，早点暴露 manifest 写错的问题
  let bundle = buildBundle(publicDir, log);
  let bundleCheckedAt = Date.now();

  function getBundle() {
    // 每 2 秒最多重算一次，避免频繁 statSync
    if (Date.now() - bundleCheckedAt > 2000) {
      bundleCheckedAt = Date.now();
      try {
        bundle = buildBundle(publicDir, null);
      } catch (e) {
        log('error', e.message);
      }
    }
    return bundle;
  }

  return function serve(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    if (rel.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad path');
      return;
    }

    // ---- 前端合包 ----
    if (rel === '/app.js') {
      const b = getBundle();
      if (!b) return notFound(res);
      return send(req, res, '/app.js', makeEntry('/app.js', b.body), false);
    }

    const file = path.join(publicDir, rel);

    // ---- 内存缓存命中 ----
    const hit = cache.get(rel);
    if (hit) return send(req, res, rel, hit, IMMUTABLE.test(rel));

    fs.readFile(file, (err, data) => {
      if (err) return notFound(res);
      const entry = makeEntry(file, data);
      cache.set(rel, entry);
      send(req, res, rel, entry, IMMUTABLE.test(rel));
    });
  };
}

function send(req, res, rel, entry, immutable) {
  const etag = entry.etag;

  // 协商缓存：内容没变就 304，一个字节都不传
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end();
    return;
  }

  const enc = pickEncoding(req);
  const body = enc === 'br' && entry.br ? entry.br : enc === 'gzip' && entry.gzip ? entry.gzip : entry.raw;

  const headers = {
    'Content-Type': entry.type,
    'Content-Length': body.length,
    ETag: etag,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
  };
  if (body !== entry.raw) {
    headers['Content-Encoding'] = enc === 'br' && entry.br ? 'br' : 'gzip';
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

module.exports = { createStaticServer, MIME, buildBundle };
