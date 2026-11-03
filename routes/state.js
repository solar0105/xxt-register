'use strict';
const { lanIPs, writeAddressFile } = require('../lib/net');
const { PORT, PIN } = require('../lib/config');
/** 状态总览 */


module.exports = function register({ route, store, cx, scheduler, log, sess, withSession, placeFromRequest, pickActiveId }) {
route('GET', '/api/state', async () => {
  const db = store.get();
  const s = sess.get();
  writeAddressFile(PORT);
  return {
    me: { id: store.currentUid(), label: (s && s.user && s.user.name) || null },
    loggedIn: !!(s && s.loggedIn),
    user:
      s && s.user
        ? {
            name: s.user.name,
            uid: s.user.uid,
            fid: s.user.fid,
            uname: s.user.uname,
            pic: s.user.pic,
            puid: s.user.puid,
            hasSignToken: !!s.ensureCidInfo(),
          }
        : null,
    phone: s ? s.phone : null,
    places: db.places,
    plans: db.plans,
    face: db.face,
    courses: db.courses,
    autosign: db.autosign,
    scheduler: scheduler.status(),
    server: { port: PORT, ips: lanIPs(), pinRequired: !!PIN, platform: process.platform },
  };
});
};
