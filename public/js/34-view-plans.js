/* 计划页 */
// ---------------------------------------------------------------- 计划页

function renderPlans() {
  const st = S.state;
  const courses = st.courses || [];
  const places = st.places || [];
  const days = [
    [1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [7, '日'],
  ];

  let h = `
  <div class="card">
    <h3>新建计划 <span class="sub">到点开始值守，出现签到即自动执行</span></h3>
    <div class="row" style="gap:8px">
      <label class="field grow" style="margin:0"><span>时间</span><input id="planTime" type="time" value="07:50"></label>
      <label class="field grow" style="margin:0"><span>值守时长</span>
        <select id="planWindow">
          <option value="10">10 分钟</option>
          <option value="20" selected>20 分钟</option>
          <option value="30">30 分钟</option>
          <option value="45">45 分钟</option>
          <option value="60">60 分钟</option>
        </select>
      </label>
    </div>
    <label class="field"><span>重复</span>
      <div class="row wrap" id="planDays" style="gap:6px">
        ${days.map(([v, t]) => `<button type="button" class="small daychip" data-day="${v}">${t}</button>`).join('')}
      </div>
    </label>
    <label class="field"><span>课程</span>
      <select id="planCourse">
        <option value="0">全部课程</option>
        ${courses.map((c) => `<option value="${c.courseId}">${esc(c.name)}</option>`).join('')}
      </select>
    </label>
    <label class="field"><span>地点</span>
      <select id="planPlace">
        ${places.length ? places.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') : '<option value="">（先去地点页添加）</option>'}
      </select>
    </label>
    <div class="row" style="gap:8px">
      <button class="grow ghost small" data-act="refresh-courses">刷新课程列表</button>
      <button class="grow ghost small" data-act="use-face" id="useFaceBtn">人脸：开</button>
    </div>
    <button class="block primary" style="margin-top:12px" data-act="add-plan">添加计划</button>
    <p class="tiny muted" style="margin:10px 0 0">不选星期 = 每天。计划只在「签到」页的自动签到开关打开时生效。</p>
  </div>`;

  h += `<div class="card"><h3>我的计划 <span class="sub">${st.plans.length} 个</span></h3>`;
  if (!st.plans.length) {
    h += '<div class="empty">还没有计划</div>';
  } else {
    h += '<div class="list">';
    for (const p of st.plans) {
      const course = p.courseId ? courses.find((c) => c.courseId === p.courseId) : null;
      const place = places.find((x) => x.id === p.placeId);
      const dl = (p.days || []).length ? p.days.map((d) => days.find((x) => x[0] === d)[1]).join('') : '每天';
      h += `
      <div class="item">
        <div class="grow">
          <div class="title">${p.time} <span class="badge ${p.enabled ? 'ok' : ''}">${p.enabled ? '启用' : '停用'}</span></div>
          <div class="desc">${dl} · ${esc(course ? course.name : '全部课程')} · ${esc(place ? place.name : '地点已删除')} · ${p.windowMinutes}min${p.useFace ? ' · 人脸' : ''}</div>
        </div>
        <button class="small ghost" data-act="toggle-plan" data-id="${p.id}">${p.enabled ? '停用' : '启用'}</button>
        <button class="small danger" data-act="del-plan" data-id="${p.id}">删</button>
      </div>`;
    }
    h += '</div>';
  }
  h += '</div>';
  return h;
}
