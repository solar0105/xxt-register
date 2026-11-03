/* 启动 */
// ---------------------------------------------------------------- 启动

async function boot() {
  const qTab = new URLSearchParams(location.search).get('tab');
  if (qTab && ['sign', 'courses', 'places', 'face', 'plans'].includes(qTab)) S.tab = qTab;
  try {
    await refresh();
  } catch (e) {
    toast('连接服务端失败：' + e.message, 'bad');
  }
  // 登录后自动拉取「我的课程」
  if (S.state && S.state.loggedIn && !(S.state.courses || []).length) {
    try {
      await api('/api/courses', { body: {} });
      await refresh();
    } catch {
      /* 静默失败，用户可以手动点 */
    }
  }
  // 定时刷新状态（自动签到运行时能看到进度）
  setInterval(async () => {
    if (S.busy) return;
    try {
      const st = await api('/api/state');
      const changed =
        !S.state ||
        st.autosign.enabled !== S.state.autosign.enabled ||
        st.scheduler.activeWindows.length !== S.state.scheduler.activeWindows.length;
      S.state = st;
      if (changed) {
        $('#brandDot').className = 'dot' + (st.loggedIn ? ' on' : '');
        if (S.tab === 'sign') render();
      }
    } catch {
      /* 忽略轮询错误 */
    }
  }, 15000);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
