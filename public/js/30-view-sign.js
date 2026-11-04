/* 签到页 */
// ---------------------------------------------------------------- 签到页

function renderSign() {
  const st = S.state;
  let h = '';

  if (!st.loggedIn) {
    const mode = S.loginMode || 'pwd';
    h += `
    <div class="card">
      <h3>登录学习通 <span class="sub">${mode === 'pwd' ? '密码只存在本机' : '用学习通 App 扫一下'}</span></h3>
      <div class="seg">
        <button class="${mode === 'pwd' ? 'on' : ''}" data-act="login-mode" data-id="pwd">账号密码</button>
        <button class="${mode === 'qr' ? 'on' : ''}" data-act="login-mode" data-id="qr">扫码登录</button>
      </div>`;

    if (mode === 'pwd') {
      h += `
      <label class="field"><span>手机号</span><input id="phone" inputmode="numeric" placeholder="11 位手机号"></label>
      <label class="field"><span>密码</span><input id="password" type="password" placeholder="学习通密码"></label>
      <button class="block primary" data-act="login">登录</button>
      <p class="tiny muted" style="margin:12px 0 0">
        登录后自动获取设备指纹（cxcid/sc），用于生成人脸校验签名。密码用学习通自己的密钥加密后存在本机。
      </p>`;
    } else {
      const hasQr = !!S.qrImage;
      h += `
      <div class="qrpanel">
        <div class="qrframe">
          ${
            hasQr
              ? `<img src="${S.qrImage}" alt="登录二维码">`
              : '<div class="ph">还没有二维码<br>点下面按钮生成</div>'
          }
        </div>
        <p class="tiny muted" id="qrStatus" style="margin:10px 0 0">${
          hasQr ? '打开学习通 App → 右上角「扫一扫」' : '生成后用学习通 App 扫码'
        }</p>
        <button class="block ${hasQr ? '' : 'primary'}" style="margin-top:12px" data-act="qr-start">
          ${hasQr ? '刷新二维码' : '生成二维码'}
        </button>
      </div>`;
    }

    h += `
      <p class="tiny muted" style="margin:12px 0 0;border-top:1px solid var(--line);padding-top:12px">
        短信验证码登录暂不支持：学习通发短信前要先过滑块验证码，验证码登录的提交接口也没公开。
        扫码效果一样，还不用输密码。
      </p>
    </div>`;
    return h;
  }

  h += `
  <div class="card">
    <h3>自动签到
      <span class="grow"></span>
      <span class="badge ${st.autosign.enabled ? 'ok' : ''}">${st.autosign.enabled ? '运行中' : '已停用'}</span>
    </h3>
    <div class="row">
      <div class="grow tiny muted">
        ${st.autosign.enabled
          ? `调度器已启动${st.scheduler.activeWindows.length ? ` · 值守：${st.scheduler.activeWindows.map((w) => w.name + ' ' + w.leftSeconds + 's').join('、')}` : ''}`
          : '开启后按「计划」里的时间自动值守并签到'}
      </div>
      <button class="small ${st.autosign.enabled ? 'danger' : 'primary'}" data-act="toggle-auto">
        ${st.autosign.enabled ? '关闭' : '开启'}
      </button>
    </div>
  </div>`;

  const places = st.places || [];
  h += `
  <div class="card">
    <h3>立即签到 <span class="sub">${places.length ? '先选地点，再签' : '还没有地点'}</span></h3>
    ${
      places.length
        ? `<label class="field" style="margin:0 0 10px">
      <span>用哪个地点签到</span>
      <select id="placeSel">
        ${places
          .map((p) => {
            const on = p.id === currentPlaceId() ? 'selected' : '';
            return `<option value="${p.id}" ${on}>${esc(p.name)}（${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}）</option>`;
          })
          .join('')}
      </select>
    </label>`
        : ''
    }
    <div class="row">
      <button class="grow" data-act="scan">扫描当前签到</button>
      <button class="grow ok" data-act="sign-all">一键全签</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="grow ghost small" data-act="scan-all">查看全部活动类型（排查用）</button>
    </div>
    ${places.length ? '' : '<p class="tiny muted" style="margin:10px 0 0">先到「地点」页添加一个坐标，或直接点扫描后选择「取签到点」。</p>'}
  </div>

  <div class="card">
    <h3>其他方式签到 <span class="sub">二维码 / 链接 / 签到码</span></h3>
    <p class="tiny muted" style="margin:0 0 10px">
      把老师投屏的二维码内容、群聊里的签到链接、或老师口头报的签到码贴进来。
      服务器会自己判断这次该用哪种方式，不用你选。
    </p>
    <input id="smartInput" placeholder="二维码内容 / 签到链接 / 4~8 位签到码" style="font-size:13px">
    <button class="block primary" style="margin-top:8px" data-act="sign-smart">签到</button>
  </div>`;

  h += '<div class="card"><h3>待签到活动 <span class="sub">进行中的签到</span></h3>';
  if (!S.scanned.length) {
    h += '<div class="empty">点上方「扫描当前签到」获取列表</div>';
  } else {
    h += '<div class="list">';
    for (const a of S.scanned) {
      const info = S.infoCache[a.activeId];
      h += `
      <div class="item">
        <div class="grow">
          <div class="title">${esc(a.name)}</div>
          <div class="desc">${esc(a.courseName)} · ${ago(a.startTime)}</div>
          <div class="row wrap" style="margin-top:6px;gap:6px">
            ${info && info.needFace ? '<span class="badge accent">需人脸</span>' : ''}
            ${info && info.needFace && !st.face.objectId ? '<span class="badge bad">缺人脸照</span>' : ''}
            ${info && info.range ? `<span class="badge">范围 ${info.range}m</span>` : ''}
            ${info && info.lat ? `<span class="badge">签到点 ${info.lat.toFixed(5)},${info.lng.toFixed(5)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="small primary" data-act="sign-one" data-id="${a.activeId}">签到</button>
          <button class="small ghost" data-act="take-point" data-id="${a.activeId}">取点</button>
        </div>
      </div>`;
    }
    h += '</div>';
  }
  h += '</div>';

  if (S.allActivities) {
    h += `
    <div class="card">
      <h3>全部活动 <span class="sub">${S.allActivities.length} 条 · 排查漏签用</span></h3>
      <p class="tiny muted" style="margin:0 0 10px">
        列出所有课程「活动列表」里的全部条目，不限类型。
        如果某个签到在这里都找不到，说明它压根没进活动列表（多半是群聊消息），代码层面扫不到。
      </p>
      <div class="list">`;
    for (const a of S.allActivities.slice(0, 60)) {
      const t = new Date(a.startTime || Date.now());
      const when = `${t.getMonth() + 1}-${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      h += `
      <div class="item" style="${a.signable ? 'border-color:#2c6a52' : ''}">
        <div class="grow">
          <div class="title" style="font-size:13px">${esc(a.name || '(无标题)')}</div>
          <div class="desc">${esc(a.course)} · ${when}</div>
          <div class="row wrap" style="margin-top:5px;gap:5px">
            <span class="badge mono">type ${a.type}</span>
            <span class="badge ${a.status === 1 ? 'ok' : ''}">${a.status === 1 ? '进行中' : '已结束'}</span>
            ${a.signable ? '<span class="badge accent">可签</span>' : ''}
          </div>
        </div>
        ${a.signable ? `<button class="small primary" data-act="sign-one" data-id="${a.activeId}">签到</button>` : ''}
      </div>`;
    }
    h += '</div></div>';
  }

  h += '</div>';
  return h;
}
