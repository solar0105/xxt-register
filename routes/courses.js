'use strict';
/** 课程与活动扫描 */


module.exports = function register({ route, store, cx, scheduler, log, sess, withSession, placeFromRequest, pickActiveId }) {
route('POST', '/api/courses', async () => {
  const list = await withSession((s) => s.getCourses());
  const db = store.get();
  db.courses = list;
  store.save();
  log('info', `已加载 ${list.length} 门课程`);
  return { courses: list };
});

route('POST', '/api/activities/scan', async ({ body }) => {
  const courseId = Number(body.courseId || 0);
  return withSession(async (s) => {
    const items = await scheduler.collectCandidates(s, courseId);
    return {
      items: items.map((a) => ({
        activeId: a.activeId,
        name: a.name,
        courseName: a.courseName,
        courseId: a.courseId,
        classId: a.classId,
        type: a.type,
        startTime: a.startTime,
        ext: a.ext,
        ageMinutes: Math.round((Date.now() - a.startTime) / 60000),
      })),
    };
  });
});

route('POST', '/api/activities/all', async ({ body }) => {
  const courseId = Number(body.courseId || 0);
  return withSession(async (s) => {
    const items = await scheduler.listAllActivities(s, courseId);
    items.sort((a, b) => b.startTime - a.startTime);
    return { items };
  });
});

route('GET', '/api/active-info', async ({ url }) => {
  const activeId = Number(url.searchParams.get('activeId'));
  if (!activeId) throw new Error('缺少 activeId');
  return withSession(async (s) => {
    const info = await s.getActiveInfo(activeId);
    return {
      lat: info.locationLatitude,
      lng: info.locationLongitude,
      range: info.locationRange,
      needFace: info.needFace,
      needAddress: info.needAddress,
      needCaptcha: info.needCaptcha,
    };
  });
});
};
