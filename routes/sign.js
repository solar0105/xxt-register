'use strict';
/** 签到：统一入口 / 批量 / 定时 */


module.exports = function register({ route, store, cx, scheduler, log, sess, withSession, placeFromRequest, pickActiveId }) {
route('POST', '/api/sign/smart', async ({ body }) => {
  const input = String(body.input || '').trim();
  const qr = cx.parseQrPayload(input);

  let activeId = Number(body.activeId) || qr.activeId || pickActiveId(input);
  const enc = qr.enc || '';

  // 纯 4~8 位数字：老师口头报的签到码
  let signCode = '';
  if (/^\d{4,8}$/.test(input)) signCode = input;
  else if (input && /^\d{4,8}$/.test(String(body.signCode || ''))) signCode = String(body.signCode);

  if (!activeId) {
    throw new Error('没找到活动 ID：贴签到链接/二维码内容，或在上面活动列表里点「签到」');
  }

  const place = placeFromRequest(body);
  const db = store.get();
  const useFace = body.useFace !== false;

  return withSession(async (s) => {
    const info = await s.getActiveInfo(activeId);
    const classId = Number(info.raw.clazzid || info.raw.classId || 0);

    let courseId = Number(info.raw.courseId || 0);
    if (!courseId && classId) {
      let courses = store.get().courses || [];
      if (!courses.length) {
        courses = await s.getCourses();
        store.save();
      }
      const hit = courses.find((c) => Number(c.classId) === classId);
      if (hit) courseId = Number(hit.courseId);
    }
    if (!classId) throw new Error('这个活动拿不到班级 id，可能不是签到活动');
    if (!courseId) throw new Error('拿不到课程 id，先去「课程」页刷新一下再试');

    // 服务端自己判断这次要什么
    const needQr = Number(info.raw.ifrefreshewm) === 1;
    if (needQr && !enc) {
      return {
        ok: false,
        need: 'qr',
        message: '这是扫码签到：把老师投屏的二维码内容贴进来（同学拍照发你也行）',
        activeId, courseId, classId,
      };
    }

    const objectId = useFace && info.needFace ? db.face.objectId : null;
    const r = await s.sign({
      activeId, courseId, classId,
      ext: '',
      place,
      objectId,
      qrEnc: enc || null,
      signCode: signCode || null,
    });

    const label = input ? input.slice(0, 24) : 'activeId=' + activeId;
    log(r.ok ? 'ok' : 'error',
      `签到 ${label} ${r.ok ? (r.already ? '（已签过）' : '成功') : '：' + (r.text || r.kind)}`);

    // 服务端说缺签到码，回给前端要一次
    const txt = String(r.text || '');
    if (!r.ok && !signCode && /签到码|手势/.test(txt)) {
      return { ok: false, need: 'code', message: '这个签到要签到码/手势码，请把老师报的码填进来', activeId, courseId, classId, text: txt };
    }

    return {
      ok: r.ok,
      already: !!r.already,
      kind: r.kind || 'ok',
      text: r.text,
      distance: r.distance ?? null,
      activeId, courseId, classId,
      needFace: info.needFace,
      needQr,
      usedQr: !!enc,
      usedCode: !!signCode,
    };
  });
});

route('POST', '/api/sign', async ({ body }) => {
  const activeId = Number(body.activeId);
  const courseId = Number(body.courseId);
  const classId = Number(body.classId);
  if (!activeId || !courseId || !classId) throw new Error('缺少活动/课程参数');

  const place = placeFromRequest(body);
  const db = store.get();
  const useFace = body.useFace !== false;
  const objectId = useFace ? db.face.objectId : null;

  return withSession(async (s) => {
    const info = await s.getActiveInfo(activeId);
    const r = await s.sign({
      activeId,
      courseId,
      classId,
      ext: body.ext || '',
      place,
      objectId: useFace && info.needFace ? objectId : null,
    });

    const label = `activeId=${activeId}`;
    if (r.ok) {
      log('ok', `签到成功 ${label}${r.already ? '（此前已签）' : ''}`);
    } else {
      const d =
        r.kind === 'location'
          ? `位置不在范围，差 ${r.distance ?? '?'} 米`
          : r.kind === 'face'
            ? `人脸未通过：${r.text}`
            : r.kind === 'captcha'
              ? '需要滑块验证码，请在手机 App 手动签到一次'
              : r.kind === 'device'
                ? '同一设备不允许重复签到，请更换 deviceCode'
                : r.text || r.kind;
      log('error', `签到失败 ${label}：${d}`);
    }
    return {
      ok: r.ok,
      already: !!r.already,
      kind: r.kind || 'ok',
      distance: r.distance ?? null,
      text: r.text,
      needFace: info.needFace,
      usedFace: !!(useFace && info.needFace && objectId),
      at: { lat: place.lat, lng: place.lng },
      attempts: r.attempts,
    };
  });
});

route('POST', '/api/sign/auto', async ({ body }) => {
  const place = placeFromRequest(body);
  const db = store.get();
  return withSession((s) =>
    scheduler.runOnce(s, {
      courseId: Number(body.courseId || 0),
      place,
      useFace: body.useFace !== false,
      faceObjectId: db.face.objectId,
    }),
  );
});

route('POST', '/api/autosign', async ({ body }) => {
  const db = store.get();
  db.autosign.enabled = !!body.enabled;
  store.save();
  if (db.autosign.enabled) {
    scheduler.start({ getSession });
    log('ok', '自动签到已开启');
  } else {
    scheduler.stop();
    log('warn', '自动签到已关闭');
  }
  return { autosign: db.autosign, scheduler: scheduler.status() };
});
};
