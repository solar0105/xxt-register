'use strict';
/** 常用地点 */


module.exports = function register({ route, store, cx, scheduler, log, sess, withSession, placeFromRequest, pickActiveId }) {
route('GET', '/api/places', async () => ({ places: store.get().places }));

route('POST', '/api/places', async ({ body }) => {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('经纬度无效');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('经纬度超出范围');
  const db = store.get();
  const p = {
    id: crypto.randomUUID().slice(0, 8),
    name: String(body.name || '常用地点').slice(0, 40),
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    address: String(body.address || body.name || '常用地点').slice(0, 120),
  };
  db.places.push(p);
  store.save();
  log('info', `已保存地点「${p.name}」(${p.lat}, ${p.lng})`);
  return { place: p, places: db.places };
});

route('POST', '/api/places/:id/promote', async ({ params }) => {
  const db = store.get();
  const idx = db.places.findIndex((p) => p.id === params.id);
  if (idx < 0) throw new Error('地点不存在');
  const [p] = db.places.splice(idx, 1);
  db.places.unshift(p);
  store.save();
  log('info', `默认签到地点已切换为「${p.name}」`);
  return { places: db.places };
});

route('DELETE', '/api/places/:id', async ({ params }) => {
  const db = store.get();
  const before = db.places.length;
  db.places = db.places.filter((p) => p.id !== params.id);
  db.plans = db.plans.filter((p) => p.placeId !== params.id);
  store.save();
  return { removed: before - db.places.length, places: db.places, plans: db.plans };
});
};
