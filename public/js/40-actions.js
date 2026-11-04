/* 按钮动作 + 签到结果处理 */
// ---------------------------------------------------------------- 事件绑定

let pickFace = true;

function bind() {
  $$('[data-act]').forEach((el) => {
    el.onclick = () => {
      const act = el.dataset.act;
      const id = el.dataset.id;
      const fn = ACTIONS[act];
      if (fn) guard(() => fn(el, id), el.tagName === 'BUTTON' ? el : null);
    };
  });

  $$('.tab').forEach((b) => {
    b.onclick = () => {
      S.tab = b.dataset.tab;
      render();
    };
  });

  const placeSel = $('#placeSel');
  if (placeSel) {
    placeSel.onchange = () => {
      S.placeId = placeSel.value;
    };
  }

  const datumSel = $('#pDatum');
  if (datumSel) {
    datumSel.value = S.datum;
    datumSel.onchange = () => {
      S.datum = datumSel.value;
      if (S.map) {
        const c = S.map.getCenter();
        const [la, ln] = fromGcj(c.lat, c.lng, S.datum);
        $('#pLat').value = la.toFixed(6);
        $('#pLng').value = ln.toFixed(6);
      }
    };
  }
  ['pLat', 'pLng'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.onchange = () => syncMapFromInputs();
  });

  const dz = $('#planDays');
  if (dz) {
    $$('.daychip', dz).forEach((c) => {
      c.onclick = () => c.classList.toggle('primary');
    });
  }
  const uf = $('#useFaceBtn');
  if (uf) {
    uf.textContent = `人脸：${pickFace ? '开' : '关'}`;
    uf.onclick = () => {
      pickFace = !pickFace;
      uf.textContent = `人脸：${pickFace ? '开' : '关'}`;
    };
  }

  if (S.tempPoint && $('#pName')) {
    $('#pName').value = S.tempPoint.address || '签到点';
  }
}

/** 生成一张登录二维码并开始轮询 */
async function startQr() {
  if (S.qrTimer) {
    clearTimeout(S.qrTimer);
    S.qrTimer = null;
  }
  S.qrImage = null;
  const r = await api('/api/qr/start', { body: {} });
  S.qrImage = r.image;
  S.loginMode = 'qr';
  render();
  qrPollLoop();
}

/** 每 2.5 秒问一次「扫了没」，成功后自动登录 */
function qrPollLoop() {
  if (S.qrTimer) clearTimeout(S.qrTimer);
  S.qrTimer = setTimeout(async () => {
    S.qrTimer = null;
    if (S.loginMode !== 'qr' || S.tab !== 'sign') return;
    if (S.state && S.state.loggedIn) return;

    let msg = '';
    try {
      const r = await api('/api/qr/poll', { body: {} });
      if (r.status === 'ok') {
        S.qrImage = null;
        toast(`扫码登录成功：${r.user ? r.user.name : ''}`, 'ok');
        await refresh();
        try {
          await api('/api/courses', { body: {} });
          await refresh();
        } catch {
          /* 课程拉取失败不影响登录 */
        }
        return;
      }
      msg = r.message || '';
    } catch (e) {
      const el = document.getElementById('qrStatus');
      if (el) el.textContent = e.message;
      return; // 出错就停，避免刷屏
    }

    const el = document.getElementById('qrStatus');
    if (el && msg) el.textContent = qrFriendly(msg);
    qrPollLoop();
  }, 2500);
}

/** 把学习通返回的原始状态翻成人话 */
function qrFriendly(msg) {
  if (!msg) return '等待扫码…';
  if (msg === '未登录') return '等待扫码…';
  if (msg.includes('成功')) return '已确认，正在登录…';
  return msg;
}

/** 统一处理签到结果：成功、要二维码、要签到码、位置偏差、人脸失败… */
async function handleSignResult(r) {
  if (r.ok) {
    toast(r.already ? '这个签到之前已经签过了' : '签到成功', 'ok');
    await refresh();
    return;
  }
  if (r.need === 'qr') {
    toast(r.message || '这是扫码签到，把二维码内容贴到下面的输入框', 'bad');
    return;
  }
  if (r.need === 'code') {
    toast(r.message || '这个签到要签到码，填进来再点一次', 'bad');
    return;
  }
  const msg =
    r.kind === 'location'
      ? `位置不在范围（差 ${r.distance ?? '?'} 米），去地点页调一下坐标`
      : r.kind === 'face'
        ? `人脸未通过：${r.text}`
        : r.kind === 'captcha'
          ? '这个签到要滑块验证码，只能手机 App 手动签'
          : r.text || '签到失败';
  toast(msg, 'bad');
  await refresh();
}

const ACTIONS = {
  async logout() {
    if (!confirm('退出登录？保存的地点、计划和人脸照片会保留。')) return;
    await api('/api/logout', { body: {} });
    toast('已退出登录');
    await refresh();
  },

  async 'login-mode'(el, id) {
    S.loginMode = id;
    if (id === 'qr' && !S.qrImage) {
      await startQr();
    } else {
      render();
    }
  },

  async 'qr-start'() {
    await startQr();
  },

  async login(el) {
    const phone = $('#phone').value.trim();
    const password = $('#password').value;
    const r = await api('/api/login', { body: { phone, password } });
    toast(`登录成功：${r.user.name}${r.hasSignToken ? '' : '（未取到签名密钥，人脸可能受影响）'}`, 'ok');
    await refresh();
    try {
      await api('/api/courses', { body: {} });
      await refresh();
    } catch {
      /* 课程拉取失败不影响登录 */
    }
  },

  async scan(el) {
    const r = await api('/api/activities/scan', { body: { courseId: 0 } });
    S.scanned = r.items;
    S.infoCache = {};
    for (const a of r.items) {
      try {
        S.infoCache[a.activeId] = await api(`/api/active-info?activeId=${a.activeId}`);
      } catch {
        /* 忽略单个失败 */
      }
    }
    render();
    toast(r.items.length ? `发现 ${r.items.length} 个待签到活动` : '当前没有待签到活动');
  },

  async 'scan-all'() {
    const r = await api('/api/activities/all', { body: { courseId: 0 } });
    S.allActivities = r.items;
    render();
    const signable = r.items.filter((x) => x.signable).length;
    toast(`共 ${r.items.length} 条活动，其中可签 ${signable} 条`, signable ? 'ok' : '');
  },

  async 'sign-smart'() {
    const input = ($('#smartInput')?.value || '').trim();
    if (!input) return toast('先把二维码内容/链接/签到码贴进来', 'bad');
    const st = S.state;
    if (!st.places.length) return toast('请先添加一个签到地点', 'bad');
    const r = await api('/api/sign/smart', {
      body: { input, placeId: currentPlaceId(), useFace: true },
    });
    await handleSignResult(r);
  },

  async 'sign-one'(el, id) {
    const st = S.state;
    if (!st.places.length) return toast('请先添加一个签到地点', 'bad');
    const r = await api('/api/sign/smart', {
      body: { activeId: Number(id), placeId: currentPlaceId(), useFace: true },
    });
    await handleSignResult(r);
  },

  async 'sign-all'(el) {
    const st = S.state;
    if (!st.places.length) return toast('请先添加地点', 'bad');
    const r = await api('/api/sign/auto', {
      body: { courseId: 0, placeId: currentPlaceId(), useFace: true },
    });
    toast(r.empty ? '当前没有待签到活动' : `成功 ${r.signed}，失败 ${r.failed}`, r.failed ? 'bad' : 'ok');
    await refresh();
  },

  async 'take-point'(el, id) {
    const a = S.scanned.find((x) => String(x.activeId) === String(id));
    if (!a) return;
    const info = await api(`/api/active-info?activeId=${a.activeId}`);
    if (!info.lat || !info.lng) return toast('该活动没有位置限制', 'bad');
    S.tempPoint = {
      lat: info.lat,
      lng: info.lng,
      address: a.name || '签到点',
      datum: 'gcj02',
    };
    // 服务端下发的坐标原样使用，不做换算
    S.datum = 'gcj02';
    S.tab = 'places';
    render();
    if (S.map) S.map.setView([info.lat, info.lng], 18);
    toast(`已带入签到点 ${info.lat.toFixed(5)},${info.lng.toFixed(5)}（${info.range}m）`, 'ok');
  },

  async locate() {
    if (!S.map) return toast('地图还没加载好，稍等一下', 'bad');
    try {
      await locateTo(S.map);
      toast('已定位到当前位置', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      const h = $('#locateHint');
      if (h) h.textContent = e.message;
    }
  },

  async 'save-place'() {
    const lat = parseFloat($('#pLat').value);
    const lng = parseFloat($('#pLng').value);
    const name = $('#pName').value.trim() || '常用地点';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return toast('经纬度无效', 'bad');
    const r = await api('/api/places', {
      body: { name, lat, lng, address: name },
    });
    S.tempPoint = null;
    toast('已保存', 'ok');
    await refresh();
  },

  async 'promote-place'(el, id) {
    await api(`/api/places/${id}/promote`, { body: {} });
    await refresh();
    toast('已设为默认地点', 'ok');
  },

  async 'del-place'(el, id) {
    if (!confirm('删除该地点？相关计划也会被移除。')) return;
    await api(`/api/places/${id}`, { method: 'DELETE' });
    await refresh();
    toast('已删除');
  },

  async 'face-refresh'(el) {
    const r = await api('/api/face/refresh', { body: { _: 1 } });
    toast('已获取档案人脸照', 'ok');
    await refresh();
  },

  async 'face-upload'(el) {
    $('#faceFile').click();
    $('#faceFile').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const buf = await compressImage(file);
      await guard(async () => {
        await api('/api/face/upload', { raw: buf });
        toast('上传成功', 'ok');
        await refresh();
      });
    };
  },

  async 'face-manual'(el) {
    const objectId = $('#faceObjectId').value.trim();
    if (!objectId) return toast('请填写 objectId', 'bad');
    await api('/api/face/custom', { body: { objectId } });
    toast('已保存', 'ok');
    await refresh();
  },

  async 'check-course'(el, courseId) {
    const classId = Number(el.dataset.cid);
    const r = await api('/api/activities/scan', { body: { courseId: Number(courseId) } });
    if (!r.items.length) {
      return toast('这门课当前没有待签到活动', '');
    }
    S.scanned = r.items;
    S.infoCache = {};
    for (const a of r.items) {
      try {
        S.infoCache[a.activeId] = await api(`/api/active-info?activeId=${a.activeId}`);
      } catch {
        /* 单个失败无妨 */
      }
    }
    S.tab = 'sign';
    render();
    toast(`这门课有 ${r.items.length} 个待签到`, 'ok');
  },

  async 'refresh-courses'() {
    const r = await api('/api/courses', { body: { _: 1 } });
    toast(`已加载 ${r.courses.length} 门课程`, 'ok');
    await refresh();
  },

  async 'add-plan'(el) {
    const time = $('#planTime').value;
    const courseId = Number($('#planCourse').value || 0);
    const placeId = $('#planPlace').value;
    const windowMinutes = Number($('#planWindow').value);
    const days = $$('.daychip.primary').map((c) => Number(c.dataset.day));
    if (!placeId) return toast('请先添加地点', 'bad');
    if (!/^\d{2}:\d{2}$/.test(time)) return toast('请选择时间', 'bad');
    await api('/api/plans', {
      body: { time, courseId, placeId, windowMinutes, days, useFace: pickFace },
    });
    toast('计划已添加', 'ok');
    await refresh();
  },

  async 'toggle-plan'(el, id) {
    await api(`/api/plans/${id}/toggle`, { body: {} });
    await refresh();
  },

  async 'del-plan'(el, id) {
    if (!confirm('删除该计划？')) return;
    await api(`/api/plans/${id}`, { method: 'DELETE' });
    await refresh();
    toast('已删除');
  },

  async 'toggle-auto'() {
    const next = !S.state.autosign.enabled;
    await api('/api/autosign', { body: { enabled: next } });
    toast(next ? '自动签到已开启' : '自动签到已关闭', next ? 'ok' : '');
    await refresh();
  },

};

// 压缩图片再上传
function compressImage(file, maxSide = 1080, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cv.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片处理失败'))), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('无法读取图片'));
    img.src = URL.createObjectURL(file);
  });
}
