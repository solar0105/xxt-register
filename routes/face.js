'use strict';
/** 人脸照片 */


module.exports = function register({ route, store, cx, scheduler, log, sess, withSession, placeFromRequest, pickActiveId }) {
route('GET', '/api/face', async () => {
  const db = store.get();
  return {
    objectId: db.face.objectId,
    source: db.face.source,
    updatedAt: db.face.updatedAt,
    url: db.face.objectId ? cx.faceImageUrl(db.face.objectId) : null,
  };
});

route('POST', '/api/face/refresh', async () => {
  return withSession(async (s) => {
    const id = await s.getProfileFaceObjectId();
    if (!id) throw new Error('你的账号还没有存档人脸照片，请在其他入口上传一张');
    const db = store.get();
    db.face = { objectId: id, source: 'archive', updatedAt: Date.now() };
    store.save();
    log('ok', `已获取本人档案人脸照：${id.slice(0, 8)}`);
    return { objectId: id, url: cx.faceImageUrl(id) };
  });
});

route('POST', '/api/face/custom', async ({ body }) => {
  const objectId = String(body.objectId || '').trim();
  if (!objectId) throw new Error('缺少 objectId');
  const db = store.get();
  db.face = { objectId, source: 'manual', updatedAt: Date.now() };
  store.save();
  log('info', `已设置自定义人脸照：${objectId.slice(0, 8)}`);
  return { objectId, url: cx.faceImageUrl(objectId) };
});

route('POST', '/api/face/upload', async ({ req }) => {
  const buf = await readBody(req, 8 * 1024 * 1024);
  if (!buf.length) throw new Error('没有收到图片数据');
  return withSession(async (s) => {
    const objectId = await s.uploadFaceImage(buf);
    const db = store.get();
    db.face = { objectId, source: 'upload', updatedAt: Date.now() };
    store.save();
    log('ok', `人脸照已上传到学习通云盘：${objectId.slice(0, 8)}`);
    return { objectId, url: cx.faceImageUrl(objectId), bytes: buf.length };
  });
});
};
