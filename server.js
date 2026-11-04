'use strict';
/**
 * 学习通签到助手 · 服务入口
 *
 * 职责：读配置 → 组装依赖 → 识别来客身份 → 挂路由 → 起服务。
 * 业务都在 routes/ 和 lib/ 里。
 */

const http = require('node:http');
const crypto = require('node:crypto');

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

const UID_COOKIE = 'cxuid';
const UID_MAX_AGE = 365 * 24 * 3600;

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

/** 只认已经存在的用户；不认识的一律当作新访客（防止随便造个 cookie 绕过口令） */
function knownUid(req) {
  const uid = parseCookies(req)[UID_COOKIE];
  return uid && store.exists(uid) ? uid : null;
}

function setUidCookie(res, uid) {
  res.setHeader(
    'Set-Cookie',
    `${UID_COOKIE}=${uid}; Path=/; Max-Age=${UID_MAX_AGE}; HttpOnly; SameSite=Lax`,
  );
}

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

  let uid = knownUid(req);

  // ---- 口令闸门：只在「还没有身份」时拦，拦住的是创建新账号 ----
  if (pin.enabled && !uid) {
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
        sendJSON(res, 401, { error: '需要注册口令', needPin: true });
        return;
      }
      const tried = url.searchParams.has('pin');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>需要口令</title>' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<body style="font:16px system-ui;padding:24px;background:#0f1115;color:#e6e6e6">' +
          '<h3>输入访问口令</h3>' +
          (tried
            ? '<p style="color:#e06c75;margin:0 0 12px">口令不对，再试一次</p>'
            : '') +
          '<form method="get">口令：<input name="pin" autofocus autocapitalize="off" ' +
          'autocorrect="off" spellcheck="false"><button>进入</button></form></body>',
      );
      return;
    }
  }

  // ---- 分配身份 ----
  if (!uid) {
    uid = crypto.randomBytes(12).toString('hex');
    store.ensure(uid);
    setUidCookie(res, uid);
    log('info', `新用户 ${uid.slice(0, 6)}… 已创建`);
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
    // 整个处理链跑在这个用户的上下文里，store.get() 自动落到他那份数据
    await store.runWith(uid, async () => {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await (url.pathname === '/api/face/upload' ? Promise.resolve({}) : readJSON(req))
        : {};
      const result = await hit.handler({ req, res, url, params: hit.params, body });
      if (!res.headersSent) sendJSON(res, 200, result);
    });
  } catch (e) {
    if (res.headersSent) return;
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
  console.log(`   口令  ${PIN ? '已启用（作为注册闸门）' : '（未设置，任何人可直接创建账号）'}`);
  console.log(`   用户  ${store.listUsers().length} 个`);
  console.log('');
  writeAddressFile(PORT);

  // 调度器必须在启动时就跑起来：之前只在「打开自动签到」那一刻 start，
  // 服务一重启就永远不会恢复（界面上开关是开的，实际没有任何定时任务）。
  scheduler.start({ getSession: () => sess.require() });
  log('info', '定时值守调度已启动（全局常驻，按用户开关生效）');
});

process.on('SIGINT', () => {
  console.log('\n  正在退出…');
  store.persistNow();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.persistNow();
  process.exit(0);
});
