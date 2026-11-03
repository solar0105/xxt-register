'use strict';
/** 登录：账号密码 / 扫码 / 退出 */


// 扫码登录的临时状态（同一会话内 start / poll 共享）
let qrPending = null;

module.exports = function register({ route, store, cx, scheduler, log, sess, withSession, placeFromRequest, pickActiveId }) {
route('POST', '/api/login', async ({ body }) => {
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  if (!/^1\d{10}$/.test(phone)) throw new Error('请输入 11 位手机号');
  if (!password) throw new Error('请输入密码');

  const s = new cx.Session({});
  await s.login(phone, password);
  sess.set(s);
  const db = store.get();
  db.courses = [];
  store.save();

  log('ok', `登录成功：${s.user.name}（uid=${s.user.uid}）`);
  return {
    ok: true,
    user: { name: s.user.name, uid: s.user.uid, fid: s.user.fid },
    hasSignToken: !!s.ensureCidInfo(),
  };
});

route('POST', '/api/logout', async () => {
  sess.set(null);
  // 没账号就没法签到，顺手把自动签到关掉，免得调度器空转刷错误日志
  const db = store.get();
  if (db.autosign.enabled) {
    db.autosign.enabled = false;
    scheduler.stop();
  }
  store.save();
  log('warn', '已退出登录');
  return { ok: true };
});

route('POST', '/api/qr/start', async () => {
  const s = new cx.Session({});
  const q = await s.initQr();
  qrPending = { session: s, at: Date.now() };
  log('info', '已生成扫码登录二维码，等待手机确认');
  return {
    image: `data:${q.mime};base64,${q.image.toString('base64')}`,
    uuid: q.uuid,
  };
});

route('POST', '/api/qr/poll', async () => {
  if (!qrPending) throw new Error('二维码已失效，请点「刷新二维码」');
  if (Date.now() - qrPending.at > 5 * 60 * 1000) {
    qrPending = null;
    throw new Error('二维码超过 5 分钟，已失效，请刷新');
  }

  const r = await qrPending.session.pollQr();
  if (!r.status) {
    return { status: 'waiting', message: r.message || '等待扫码' };
  }

  const s = qrPending.session;
  await s.fetchUser();
  sess.set(s);
  const db = store.get();
  db.courses = [];
  store.save();

  qrPending = null;
  log('ok', `扫码登录成功：${s.user.name}（uid=${s.user.uid}）`);
  return {
    status: 'ok',
    user: { name: s.user.name, uid: s.user.uid, fid: s.user.fid },
    hasSignToken: !!s.ensureCidInfo(),
  };
});
};
