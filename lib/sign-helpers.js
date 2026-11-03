'use strict';
/** 签到相关的参数整理 */

const store = require('./store');

/** 从请求体里得到一个坐标：优先 placeId，其次 lat/lng，最后默认地点 */
function placeFromRequest(body) {
  const db = store.get();
  if (body.placeId) {
    const p = db.places.find((x) => x.id === body.placeId);
    if (!p) throw new Error('地点不存在');
    return { lat: p.lat, lng: p.lng, address: p.address, name: p.name };
  }
  if (body.lat != null && body.lng != null) {
    return {
      lat: Number(body.lat),
      lng: Number(body.lng),
      address: body.address || '签到点',
      name: '临时点位',
    };
  }
  if (db.places.length) {
    const p = db.places[0];
    return { lat: p.lat, lng: p.lng, address: p.address, name: p.name };
  }
  throw new Error('请先添加一个签到地点');
}

/** 从一段文本/链接里抠出 activeId */
function pickActiveId(text) {
  const s = String(text || '');
  const withKey = /(?:activeId|activePrimaryId|pptActiveId|activeid)=(\d{6,})/.exec(s);
  if (withKey) return Number(withKey[1]);
  const bare = /(?:^|\D)(\d{13,})(?:\D|$)/.exec(s);
  if (bare) return Number(bare[1]);
  return 0;
}

module.exports = { placeFromRequest, pickActiveId };
