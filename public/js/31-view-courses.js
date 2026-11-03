/* 课程页 */
// ---------------------------------------------------------------- 课程页

function renderCourses() {
  const st = S.state;
  if (!st.loggedIn) {
    return '<div class="card"><div class="empty">先到「签到」页登录</div></div>';
  }
  const list = st.courses || [];
  let h = `
  <div class="card">
    <h3>我的课程 <span class="sub">${list.length ? `${list.length} 门` : '未加载'}</span></h3>
    <div class="row">
      <button class="grow ${list.length ? '' : 'primary'}" data-act="refresh-courses">
        ${list.length ? '刷新课程列表' : '获取我的课程'}
      </button>
    </div>
    <p class="tiny muted" style="margin:10px 0 0">
      从学习通「我的课程」实时拉取，登录后会自动加载。点某门课的「查签到」只扫这门课。
    </p>
  </div>`;

  if (!list.length) {
    h += '<div class="card"><div class="empty">点上面按钮拉取课程</div></div>';
    return h;
  }

  h += '<div class="card"><div class="list">';
  for (const c of list) {
    h += `
    <div class="item">
      ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy"
          style="width:46px;height:46px;border-radius:9px;object-fit:cover;background:var(--bg2);flex:none"
          onerror="this.style.visibility='hidden'">` : ''}
      <div class="grow">
        <div class="title">${esc(c.name)}</div>
        <div class="desc">${esc(c.teacher || '教师未知')}</div>
        <div class="desc mono" style="font-size:11px">course ${c.courseId} · class ${c.classId}</div>
      </div>
      <button class="small primary" data-act="check-course" data-id="${c.courseId}" data-cid="${c.classId}">查签到</button>
    </div>`;
  }
  h += '</div></div>';
  return h;
}
