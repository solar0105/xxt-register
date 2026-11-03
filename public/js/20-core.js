/* 核心：刷新 + 渲染入口 */
// ---------------------------------------------------------------- 主渲染

async function refresh() {
  S.state = await api('/api/state');
  render();
}

function render() {
  if (!S.state) return;
  const st = S.state;
  $('#brandDot').className = 'dot' + (st.loggedIn ? ' on' : '');

  const ub = $('#userBox');
  if (st.loggedIn && st.user) {
    ub.innerHTML = `${st.user.pic ? `<img src="${esc(st.user.pic)}" alt="">` : ''}<b>${esc(st.user.name)}</b>`
      + '<button data-act="logout" style="padding:4px 9px;font-size:11px;border-radius:8px;'
      + 'background:transparent;border-color:#3a2a30;color:var(--danger)">退出</button>';
  } else {
    ub.innerHTML = '<span class="muted">未登录</span>';
  }

  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));

  const v = $('#view');
  const map = {
    sign: renderSign,
    courses: renderCourses,
    places: renderPlaces,
    face: renderFace,
    plans: renderPlans,
  };
  v.innerHTML = map[S.tab]() + (S.tab === 'sign' ? renderPhoneCard() : '');
  if (S.tab === 'places') mountMapAsync();
  bind();
}
