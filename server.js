'use strict';
/**
 * 学习通签到助手 · 服务入口
 *
 * 职责只有四件事：读配置、拼装依赖、挂载路由、起服务。
 * 具体业务都在 routes/ 和 lib/ 里，改哪里找哪里。
 */

const http = require('node:http');

const { PORT, HOST, PIN, PUBLIC_DIR } = require('./lib/config');
const store = require('./lib/store');
const cx = require('./lib/cx');
const scheduler = require('./lib/scheduler');
const { createStaticServer } = require('./lib/static');
const { createRouter } = require('./lib/router');
const { createSessionStore } = require('./lib/session');
const { createPinGate } = require('./lib/pin');
const { sendJSON, readJSON, parseCookies } = require('./lib/http');
const { placeFromRequest, pickActiveId } = require('./lib/sign-helpers');
const { lanIPs, writeAddressFile } = require('./lib/net');
const registerRoutes = require('./routes');

const log = (level, text) => store.addLog(level, text);

// ---- 组装 ----
const serveStatic = createStaticServer({ publicDir: PUBLIC_DIR, log });
const sess = createSessionStore({ store, log });
const pin = createPinGate(PIN);
const { route, match } = createRouter();

registerRoutes({
  route,
  store,
  cx,
  scheduler,
  log,
  sess,
  withSession: sess.withSession,
  placeFromRequest,
  pickActiveId,
});

// ---- HTTP ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 连通性探针：不校验口令，用于判断手机能否够到这台机器
  if (url.pathname === '/ping') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end('pong');
    return;
  }

  if (!pin.check(req, url)) {
    if (pin.blocked(req)) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>已锁定</title>' +
          '<body style="font:16px system-ui;padding:40px;background:#0f1115;color:#e6e6e6">' +
          '<h3>口令错误次数过多</h3><p style="color:#888">已锁定 15 分钟，稍后再试。</p></body>',
      );
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJSON(res, 401, { error: 'PIN 校验失败' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><meta charset="utf-8"><title>需要口令</title>' +
        '<body style="font:16px system-ui;padding:24px;background:#0f1115;color:#e6e6e6">' +
        '<h3>需要访问口令</h3><form method="get">口令：<input name="pin" autofocus>' +
        '<button>进入</button></form>' +
        '<p style="color:#888">启动服务时通过环境变量 PIN 设置；未设置则不需要口令。</p></body>',
    );
    return;
  }

  // 通过 ?pin=xxx 进来的：种下 cookie 并去掉 URL 里的口令，
  // 否则后续 /app.js、/api/* 都不带口令，整个界面会全部 401。
  if (pin.enabled && url.searchParams.get('pin') === pin.pin && parseCookies(req).cxpin !== pin.pin) {
    const clean = new URL(url.toString());
    clean.searchParams.delete('pin');
    res.writeHead(302, {
      Location: clean.pathname + (clean.search || ''),
      'Set-Cookie': `cxpin=${encodeURIComponent(pin.pin)}; Path=/; Max-Age=${
        30 * 24 * 3600
      }; HttpOnly; SameSite=Lax`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  if (!url.pathname.startsWith('/api/')) {
    serveStatic(req, res, url.pathname);
    return;
  }

  const hit = match(req.method, url.pathname);
  if (!hit) {
    sendJSON(res, 404, { error: `未知接口 ${req.method} ${url.pathname}` });
    return;
  }

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
      ? await (url.pathname === '/api/face/upload' ? Promise.resolve({}) : readJSON(req))
      : {};
    const result = await hit.handler({ req, res, url, params: hit.params, body });
    sendJSON(res, 200, result);
  } catch (e) {
    const code = e.message === 'NOT_LOGGED_IN' ? 401 : 400;
    sendJSON(res, code, { error: e.message });
  }
});

sess.hydrate();

server.listen(PORT, HOST, () => {
  const real = lanIPs().filter((x) => !x.virtual);
  const line = '='.repeat(42);
  console.log(`\n  ${line}`);
  console.log('   学习通签到助手  已启动');
  console.log(`  ${line}`);
  console.log(`   本机  http://127.0.0.1:${PORT}`);
  if (real.length) console.log(`   手机  ${real.map((x) => `http://${x.address}:${PORT}`).join('\n         ')}`);
  console.log(`   口令  ${PIN ? '已启用' : '（未设置，仅限内网使用）'}`);
  console.log('');
  if (real.length) {
    console.log(`   手机打不开？先在同一 Wi-Fi 下用手机浏览器试：http://${real[0].address}:${PORT}/ping`);
    console.log('   连不上多半是校园网/公司 Wi-Fi 开了客户端隔离，见 README 相关章节。');
    console.log('');
  }
  writeAddressFile(PORT);
  if (real.length) {
    console.log('   地址已写入「学习通签到-当前地址.txt」（桌面也放了一份），换网络后回来看这里。');
    console.log('');
  }
});

process.on('SIGINT', () => {
  console.log('\n  正在退出…');
  store.persistNow && store.persistNow();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.persistNow && store.persistNow();
  process.exit(0);
});
