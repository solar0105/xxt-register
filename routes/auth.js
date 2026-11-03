'use strict';
/** 登录：账号密码 / 扫码 / 退出（按用户隔离） */

// 扫码登录的临时状态，按用户分开存，避免两个人同时扫码互相顶掉
const qrPending = new Map(); // uid -> { session, at }

module.exports = function register({
  route,
  store,
  cx,
  scheduler,
  log,
  sess,
  withSession,
  placeFromRequest,
  pickActiveId,
}) {
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
    // 没账号就没法签到，顺手把本人的自动签到关掉。
    // 注意：不能调用 scheduler.stop()，那是全局的，会把别人的值守也停掉。
    const db = store.get();
    if (db.autosign.enabled) db.autosign.enabled = false;
    store.save();
    log('warn', '已退出登录');
    return { ok: true };
  });

  route('POST', '/api/qr/start', async () => {
    const uid = store.currentUid();
    const s = new cx.Session({});
    const q = await s.initQr();
    qrPending.set(uid, { session: s, at: Date.now() });
    log('info', '已生成扫码登录二维码，等待手机确认');
    return {
      image: `data:${q.mime};base64,${q.image.toString('base64')}`,
      uuid: q.uuid,
    };
  });

  route('POST', '/api/qr/poll', async () => {
    const uid = store.currentUid();
    const pending = qrPending.get(uid);
    if (!pending) throw new Error('二维码已失效，请点「刷新二维码」');
    if (Date.now() - pending.at > 5 * 60 * 1000) {
      qrPending.delete(uid);
      throw new Error('二维码超过 5 分钟，已失效，请刷新');
    }

    const r = await pending.session.pollQr();
    if (!r.status) {
      return { status: 'waiting', message: r.message || '等待扫码' };
    }

    const s = pending.session;
    await s.fetchUser();
    sess.set(s);
    const db = store.get();
    db.courses = [];
    store.save();

    qrPending.delete(uid);
    log('ok', `扫码登录成功：${s.user.name}（uid=${s.user.uid}）`);
    return {
      status: 'ok',
      user: { name: s.user.name, uid: s.user.uid, fid: s.user.fid },
      hasSignToken: !!s.ensureCidInfo(),
    };
  });
};
