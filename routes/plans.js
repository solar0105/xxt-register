'use strict';
/** 定时计划与自动签到开关 */


module.exports = function register({ route, store, cx, scheduler, log, sess, withSession, placeFromRequest, pickActiveId }) {
route('POST', '/api/plans', async ({ body }) => {
  const time = String(body.time || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('时间格式应为 HH:MM');
  const db = store.get();
  const plan = {
    id: crypto.randomUUID().slice(0, 8),
    name: String(body.name || `自动签到 ${time}`).slice(0, 40),
    enabled: body.enabled !== false,
    time,
    days: Array.isArray(body.days) ? body.days.map(Number).filter((d) => d >= 1 && d <= 7) : [],
    courseId: Number(body.courseId || 0),
    placeId: body.placeId || (db.places[0] && db.places[0].id) || null,
    windowMinutes: Math.min(180, Math.max(1, Number(body.windowMinutes) || 20)),
    useFace: body.useFace !== false,
    lastRunKey: null,
  };
  db.plans.push(plan);
  store.save();
  log('info', `已添加计划「${plan.name}」${time}（值守 ${plan.windowMinutes} 分钟）`);
  return { plan, plans: db.plans };
});

route('POST', '/api/plans/:id/toggle', async ({ params, body }) => {
  const db = store.get();
  const plan = db.plans.find((p) => p.id === params.id);
  if (!plan) throw new Error('计划不存在');
  plan.enabled = body.enabled != null ? !!body.enabled : !plan.enabled;
  store.save();
  return { plan, plans: db.plans };
});

route('DELETE', '/api/plans/:id', async ({ params }) => {
  const db = store.get();
  db.plans = db.plans.filter((p) => p.id !== params.id);
  store.save();
  return { plans: db.plans };
});
};
