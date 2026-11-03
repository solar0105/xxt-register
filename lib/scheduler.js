'use strict';
/* 自动签到调度器：定点触发 → 值守窗口内轮询 → 抢到就签 */

const store = require('./store');

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 超过 6 小时的陈旧活动不再考虑
const POLL_INTERVAL = 30000;

let timer = null;
const windows = new Map();

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDow = (d) => (d.getDay() === 0 ? 7 : d.getDay());

function log(level, text) {
  store.addLog(level, text);
}

/** 收集当前可签到的活动 */
async function collectCandidates(session, courseId) {
  const db = store.get();
  let courses = db.courses || [];
  if (!courses.length || courseId) {
    const fresh = await session.getCourses();
    db.courses = fresh;
    store.save();
    courses = fresh;
  }
  if (courseId) courses = courses.filter((c) => Number(c.courseId) === Number(courseId));
  if (!courses.length) throw new Error('没有可用课程（请先刷新课程列表）');

  const out = [];
  const now = Date.now();
  for (const c of courses) {
    let res;
    try {
      res = await session.getActivities(c.courseId, c.classId);
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') throw e;
      continue;
    }
    for (const a of res.list) {
      // 只要还在进行中、且不是很久以前的，都算候选。
      // 之前卡了「20 分钟内发布」，签到开着 20 分钟以上就会漏掉。
      if (a.status !== 1) continue;
      if (now - a.startTime > MAX_AGE_MS) continue;
      out.push({ ...a, courseId: c.courseId, classId: c.classId, ext: res.ext, courseName: c.name });
    }
  }
  return out;
}

/** 调试用：把这门课活动列表里的【所有】类型原样列出来，便于排查“这种签到扫不到” */
async function listAllActivities(session, courseId) {
  const db = store.get();
  let courses = db.courses || [];
  if (!courses.length) {
    courses = await session.getCourses();
    db.courses = courses;
    store.save();
  }
  if (courseId) courses = courses.filter((c) => Number(c.courseId) === Number(courseId));

  const out = [];
  for (const c of courses) {
    let raw = [];
    try {
      const r = await session._call(
        `https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist?fid=0` +
          `&showNotStartedActive=0&courseId=${c.courseId}&classId=${c.classId}`,
      );
      raw = (JSON.parse(r.text).data || {}).activeList || [];
    } catch {
      continue;
    }
    for (const a of raw) {
      out.push({
        course: c.name,
        courseId: c.courseId,
        classId: c.classId,
        activeId: Number(a.id),
        type: Number(a.type),
        activeType: Number(a.activeType),
        status: Number(a.status),
        name: a.nameOne || a.nameFour || '',
        startTime: Number(a.startTime) || 0,
        endTime: Number(a.endTime) || 0,
        signable: (Number(a.type) === 2 || Number(a.type) === 74) && Number(a.status) === 1,
      });
    }
  }
  return out;
}

/** 对一个活动执行签到 */
async function signActivity(session, activity, place, useFace, faceObjectId) {
  const info = await session.getActiveInfo(activity.activeId);
  const objectId = useFace && info.needFace ? faceObjectId : null;
  const r = await session.sign({
    activeId: activity.activeId,
    courseId: activity.courseId,
    classId: activity.classId,
    ext: activity.ext,
    place,
    objectId,
  });
  return { info, result: r };
}

/**
 * 扫描并签到。返回 { signed, skipped, failed, messages }
 * place: { lat, lng, address }
 */
async function runOnce(session, opts = {}) {
  const { courseId = 0, place, useFace = true, faceObjectId = null, dryRun = false } = opts;
  if (!place) throw new Error('未指定签到地点');
  if (!session || !session.loggedIn) throw new Error('未登录');

  const messages = [];
  const push = (level, text) => {
    messages.push({ level, text });
    log(level, text);
  };

  const candidates = await collectCandidates(session, courseId);
  if (!candidates.length) {
    push('info', '当前没有待签到活动');
    return { signed: 0, skipped: 0, failed: 0, messages, empty: true };
  }

  let signed = 0;
  let skipped = 0;
  let failed = 0;

  for (const a of candidates) {
    const label = `《${a.courseName}》${a.name}`;
    if (dryRun) {
      push('info', `发现 ${label} (activeId=${a.activeId})`);
      continue;
    }
    try {
      const { info, result } = await signActivity(session, a, place, useFace, faceObjectId);
      if (result.ok) {
        signed++;
        push('ok', `${label} → ${result.already ? '此前已签到' : '签到成功'}`);
        if (info.needFace && !faceObjectId) push('warn', '该活动要求人脸，但未配置人脸照片');
      } else {
        failed++;
        const detail = result.kind === 'location' ? `不在范围（差 ${result.distance ?? '?'} 米）` : result.kind === 'face' ? `人脸未通过：${result.text}` : result.text || result.kind;
        push('error', `${label} → 失败：${detail}`);
      }
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') throw e;
      failed++;
      push('error', `${label} → 异常：${e.message}`);
    }
  }

  return { signed, skipped, failed, messages, empty: false };
}

function openWindow(deps, plan) {
  // 窗口按「用户:计划」隔离，多人共用同一份进程时不会互相顶掉
  const key = `${store.currentUid()}:${plan.id}`;
  if (windows.has(key)) return;
  const minutes = Math.max(1, Number(plan.windowMinutes) || 20);
  const state = { endAt: Date.now() + minutes * 60000, plan };
  windows.set(key, state);
  log('info', `⏰ 计划「${plan.name}」开始值守 ${minutes} 分钟，出现签到即自动执行`);

  const step = async () => {
    if (!windows.has(key)) return;
    if (Date.now() > state.endAt) {
      windows.delete(key);
      log('warn', `计划「${plan.name}」值守结束`);
      return;
    }
    const db = store.get();
    const place = db.places.find((p) => p.id === plan.placeId) || db.places[0];
    if (!place) {
      log('error', `计划「${plan.name}」找不到签到地点，中止`);
      windows.delete(key);
      return;
    }
    try {
      const session = await deps.getSession();
      const r = await runOnce(session, {
        courseId: plan.courseId || 0,
        place,
        useFace: plan.useFace !== false,
        faceObjectId: db.face.objectId,
      });
      if (r.signed > 0) {
        windows.delete(key);
        log('ok', `计划「${plan.name}」已完成签到`);
        return;
      }
    } catch (e) {
      log('error', `计划「${plan.name}」执行异常：${e.message}`);
    }
    if (windows.has(key)) setTimeout(step, POLL_INTERVAL);
  };
  step();
}

async function tick(deps) {
  const users = store.listUsers();
  if (!users.length) return;
  for (const uid of users) {
    try {
      // 每个用户在自己的上下文里跑，store.get() 自动落到他那份数据
      await store.runWith(uid, () => tickForUser(deps));
    } catch (e) {
      log('error', `用户 ${uid.slice(0, 6)}… 调度异常：${e.message}`);
    }
  }
}

async function tickForUser(deps) {
  const db = store.get();
  if (!db.autosign || !db.autosign.enabled) return;
  const now = new Date();
  const current = hhmm(now);
  const dow = isoDow(now);
  const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  for (const plan of db.plans) {
    if (!plan.enabled) continue;
    if (plan.time !== current) continue;
    if (Array.isArray(plan.days) && plan.days.length && !plan.days.includes(dow)) continue;
    const key = `${dayKey} ${plan.time}`;
    if (plan.lastRunKey === key) continue;
    plan.lastRunKey = key;
    store.save();
    openWindow(deps, plan);
  }
}

function start(deps) {
  stop();
  timer = setInterval(() => {
    tick(deps).catch((e) => log('error', `调度异常：${e.message}`));
  }, 15000);
  log('info', '自动签到调度已启动');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const [, st] of windows) st.endAt = 0;
  windows.clear();
}

function status() {
  return {
    running: !!timer,
    activeWindows: [...windows.values()].map((w) => ({
      name: w.plan.name,
      leftSeconds: Math.max(0, Math.round((w.endAt - Date.now()) / 1000)),
    })),
  };
}

module.exports = {
  start,
  stop,
  tick,
  status,
  runOnce,
  collectCandidates,
  listAllActivities,
  signActivity,
  log,
};
