'use strict';
/*
 * 学习通（超星）签到协议层 —— 零依赖实现
 *
 * 覆盖：
 *   登录（AES 传输加密）/ 用户信息（RSA 设备指纹）/ 课程列表 / 活动列表
 *   位置签到 / 人脸签到（活体结果由客户端声明）
 */

const https = require('node:https');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

// ---------------------------------------------------------------- 常量

const UA =
  'Dalvik/2.1.0 (Linux; U; Android 12; SM-N9006 Build/8aba9e4.0) ' +
  '(schild:2d97f7b9439f21333c946878fc4d6ccb) (device:SM-N9006) Language/zh_CN ' +
  'com.chaoxing.mobile/ChaoXingStudy_3_6.7.5_android_phone_10941_314 ' +
  '(@Kalimdor)_68f184fd763546c1a04ab3b09b3deebb';

const TRANSFER_KEY = 'u2oh6Vu^HWe4_AES';
const DEVICE_INFO_PUBLIC_KEY =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC79d8Ot0hCbxxSISC6x8SCwTBspFSzlLKHJUYqoFNu1TSRaw4hEYkOnvEaL1VyoxV6HXcDrzwYvaFZaZaPQPFnfCHZy5dQwxcmifgSHqS+oKXw40Ys4cVIqnU5d90S7EWSRdBglX489jlqVaNcQSkDx2TYmC+DbAq9FV/BU09ISQIDAQAB';
const APP_SIGNATURE = '1e27068798b6697821abbeb44a17da5483c4fb7fad7b9ce7890465ed04d0cbe0';
const RSA_PLAIN_BLOCK = 117;

const URL_LOGIN = 'https://passport2.chaoxing.com/fanyalogin';
const URL_LOGIN_PAGE =
  'https://passport2.chaoxing.com/login?fid=&refer=http%3A%2F%2Fi.chaoxing.com';
const URL_QR_IMAGE = 'https://passport2.chaoxing.com/createqr';
const URL_QR_STATUS = 'https://passport2.chaoxing.com/getauthstatus/v2';
const URL_USER_INFO = 'https://sso.chaoxing.com/apis/login/userLogin4Uname.do';
const URL_COURSE_LIST = 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1';
const URL_ACTIVE_LIST =
  'https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist?fid=0&showNotStartedActive=0';
const URL_ACTIVE_INFO = 'https://mobilelearn.chaoxing.com/v2/apis/active/getPPTActiveInfo';
const URL_PRESIGN = 'https://mobilelearn.chaoxing.com/newsign/preSign';
const URL_ANALYSIS = 'https://mobilelearn.chaoxing.com/pptSign/analysis?vs=1&DB_STRATEGY=RANDOM';
const URL_ANALYSIS2 = 'https://mobilelearn.chaoxing.com/pptSign/analysis2?DB_STRATEGY=RANDOM';
const URL_SIGN = 'https://mobilelearn.chaoxing.com/pptSign/stuSignajax';
const URL_CHECK_FACE =
  'https://mobilelearn.chaoxing.com/pptSign/check-face-result?DB_STRATEGY=PRIMARY_KEY&STRATEGY_PARA=activeId';
const URL_PROFILE_FACE =
  'https://mobilelearn.chaoxing.com/v2/apis/sign/collectionfilephotoEnc?DB_STRATEGY=DEFAULT';
const URL_CLOUD_TOKEN = 'https://pan-yz.chaoxing.com/api/token/uservalid';
const URL_CLOUD_UPLOAD = 'https://pan-yz.chaoxing.com/upload?_from=mobilelearn&_token=';
const URL_SHARED_IMAGE = 'https://p.cldisk.com/star4/%s/origin.jpg';

// 签到活动类型：2 = 普通签到，74 = 人脸/位置等扩展签到
const SIGN_TYPES = new Set([2, 74]);

// ---------------------------------------------------------------- 小工具

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function form(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`)
    .join('&');
}

function qs(obj) {
  return form(obj);
}

// ---------------------------------------------------------------- 加密

/** 传输层 AES-128-CBC，key 与 iv 都是 TRANSFER_KEY */
function aesEncrypt(plain) {
  const key = Buffer.from(TRANSFER_KEY, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, key);
  return Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]).toString('base64');
}

function publicKeyObject() {
  const body = (DEVICE_INFO_PUBLIC_KEY.match(/.{1,64}/g) || []).join('\n');
  return crypto.createPublicKey(`-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`);
}

/** 设备指纹 RSA(PKCS1) 分段加密 */
function rsaEncryptDevice(json) {
  const pub = publicKeyObject();
  const buf = Buffer.from(json, 'utf8');
  const out = [];
  for (let off = 0; off < buf.length; off += RSA_PLAIN_BLOCK) {
    const chunk = buf.subarray(off, Math.min(off + RSA_PLAIN_BLOCK, buf.length));
    out.push(crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, chunk));
  }
  return Buffer.concat(out).toString('base64');
}

/**
 * clientId 是用私钥“加密”的，这里用公钥做一次裸 RSA 解出原文（教科书式 modPow）。
 * 返回 JSON 对象，含 cid（即 cxcid）与 sc（签名盐）。
 */
function rsaDecryptClientId(clientId) {
  const pub = publicKeyObject();
  const enc = Buffer.from(clientId, 'base64');
  const blockSize = 128;
  const parts = [];
  for (let off = 0; off < enc.length; off += blockSize) {
    let plain;
    try {
      plain = crypto.publicDecrypt(
        { key: pub, padding: crypto.constants.RSA_NO_PADDING },
        enc.subarray(off, Math.min(off + blockSize, enc.length)),
      );
    } catch {
      return null;
    }
    if (plain.length < 3 || plain[0] !== 0x00 || plain[1] !== 0x01) return null;
    let sep = -1;
    for (let i = 2; i < plain.length; i++) {
      if (plain[i] === 0x00) {
        sep = i;
        break;
      }
    }
    if (sep < 0) return null;
    parts.push(plain.subarray(sep + 1));
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    return null;
  }
}

/** 生成稳定的随机 deviceCode（等价于 android 端的 randomizedDeviceCode） */
function randomDeviceCode(seed) {
  const raw = crypto.createHash('sha256').update(String(seed), 'utf8').digest();
  return Buffer.concat([raw, raw]).toString('base64');
}

/** 生成一份固定的“安卓设备指纹” */
function makeDeviceProfile(seed) {
  const androidId = sha256hex(seed).slice(0, 16);
  const fingerprint = 'samsung/greatltexx/greatlte:12/SP1A.210812.016/N9006ZCS4:user/release-keys';
  const unique = sha256hex(`com.chaoxing.mobile:${androidId}:${fingerprint}`);
  return {
    deviceUniqueId: unique,
    cdid: unique,
    device_id: unique,
    android_id: androidId,
    mediaDrmId: '',
    oaid: '',
    platform: 'android',
    os_name: 'android',
    os_ver: '12',
    os_lang: 'zh-CN',
    brand: 'samsung',
    board: 'greatlte',
    hardware: 'qcom',
    model: 'SM-N9006',
    cpu_ar: 'armeabi-v7a,armeabi',
    app_name: 'com.chaoxing.mobile',
    app_ver: '6.7.5',
    versionCode: '10941',
    signatures: APP_SIGNATURE,
    resolution: '1080*1920',
    dpi: '3.0',
    time_stamp: 0,
  };
}

// ---------------------------------------------------------------- HTTP

function request(urlStr, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    jar = null,
    timeout = 25000,
    redirects = 0,
  } = opts;

  const url = new URL(urlStr);
  const h = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Connection: 'keep-alive',
    ...headers,
  };
  if (jar && Object.keys(jar).length) {
    h.Cookie = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  if (body != null) h['Content-Length'] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: h,
        timeout,
        servername: url.hostname,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let raw = Buffer.concat(chunks);
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          try {
            if (enc.includes('gzip')) raw = zlib.gunzipSync(raw);
            else if (enc.includes('deflate')) raw = zlib.inflateSync(raw);
            else if (enc.includes('br')) raw = zlib.brotliDecompressSync(raw);
          } catch {
            /* 保持原样 */
          }

          const setCookies = res.headers['set-cookie'] || [];
          const parsed = {};
          for (const line of setCookies) {
            const first = String(line).split(';')[0];
            const eq = first.indexOf('=');
            if (eq > 0) parsed[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
          }
          if (jar) Object.assign(jar, parsed);

          const loc = res.headers.location;
          const status = res.statusCode || 0;
          if (loc && status >= 300 && status < 400 && redirects < 4) {
            const next = new URL(loc, urlStr).toString();
            const nextMethod = status === 303 || (status === 302 && method === 'POST') ? 'GET' : method;
            resolve(
              request(next, {
                method: nextMethod,
                headers: headers,
                body: nextMethod === 'GET' ? null : body,
                jar,
                timeout,
                redirects: redirects + 1,
              }),
            );
            return;
          }

          resolve({
            status,
            headers: res.headers,
            text: raw.toString('utf8'),
            raw,
            setCookies: parsed,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------- Session

class Session {
  constructor(state = {}) {
    this.cookies = state.cookies || {};
    this.user = state.user || null;
    this.deviceCode = state.deviceCode || null;
    this.device = state.device || null;
    this.phone = state.phone || null;
    this.encPassword = state.encPassword || null;
    this.cidInfo = null;
  }

  toJSON() {
    return {
      cookies: this.cookies,
      user: this.user,
      deviceCode: this.deviceCode,
      device: this.device,
      phone: this.phone,
      encPassword: this.encPassword,
    };
  }

  get loggedIn() {
    return !!(this.user && this.cookies && Object.keys(this.cookies).length);
  }

  async _call(url, opts = {}) {
    return request(url, { ...opts, jar: this.cookies });
  }

  /** 解出 cxcid / sc，用于 faceResult 的 signToken */
  ensureCidInfo() {
    if (this.cidInfo) return this.cidInfo;
    if (!this.user || !this.user.clientId) return null;
    const info = rsaDecryptClientId(this.user.clientId);
    if (!info || !info.cid || !info.sc) return null;
    this.cidInfo = { cxcid: String(info.cid), sc: String(info.sc) };
    return this.cidInfo;
  }

  // ------------------------------------------------ 扫码登录

  /**
   * 拉一个二维码。
   * 学习通的登录页把 uuid / enc 藏在隐藏域里，enc 是后续轮询要用的校验串。
   */
  async initQr() {
    this.device = this.device || makeDeviceProfile(this.phone || 'qr-' + Date.now());
    this.deviceCode = this.deviceCode || randomDeviceCode('qr:' + Date.now());
    this.cookies = {};

    const page = await this._call(URL_LOGIN_PAGE);
    if (page.status !== 200) throw new Error(`打不开登录页（HTTP ${page.status}）`);

    const uuid = hiddenInput(page.text, 'uuid');
    const enc = hiddenInput(page.text, 'enc');
    if (!uuid) throw new Error('登录页里没找到 uuid，学习通可能改版了');

    const img = await this._call(`${URL_QR_IMAGE}?uuid=${encodeURIComponent(uuid)}&fid=-1`, {
      headers: { Referer: URL_LOGIN_PAGE },
    });
    if (!img.raw || !img.raw.length) throw new Error('二维码图片为空');

    this.qr = { uuid, enc };
    const isPng = img.raw[0] === 0x89 && img.raw[1] === 0x50;
    return {
      uuid,
      enc,
      image: img.raw,
      mime: isPng ? 'image/png' : 'image/jpeg',
    };
  }

  /**
   * 轮询扫码状态。
   * 返回 { status:true } 时服务端已下发会话 cookie，直接 fetchUser 即可。
   */
  async pollQr() {
    if (!this.qr || !this.qr.uuid) throw new Error('二维码已失效，请刷新');
    const r = await this._call(URL_QR_STATUS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: URL_LOGIN_PAGE,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form({
        enc: this.qr.enc || '',
        uuid: this.qr.uuid,
        doubleFactorLogin: '0',
        forbidotherlogin: '0',
      }),
    });

    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`扫码状态返回异常（HTTP ${r.status}）`);
    }

    if (j.enc) this.qr.enc = j.enc;
    if (j.uuid) this.qr.uuid = j.uuid;

    return {
      status: !!j.status,
      message: j.mes || j.msg || '',
      type: j.type || '',
    };
  }

  // ------------------------------------------------ 登录

  async login(phone, password) {
    this.phone = phone;
    this.device = this.device || makeDeviceProfile(phone);
    this.deviceCode = this.deviceCode || randomDeviceCode(phone + ':devcode');
    this.cookies = {};

    const uname = aesEncrypt(phone);
    const pwd = aesEncrypt(password);
    this.encPassword = pwd;

    const r = await this._call(URL_LOGIN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://i.chaoxing.com/',
        Origin: 'https://passport2.chaoxing.com',
      },
      body: form({
        fid: '-1',
        uname,
        password: pwd,
        refer: 'https%3A%2F%2Fi.chaoxing.com',
        t: 'true',
        forbidotherlogin: '0',
        validate: '',
        doubleFactorLogin: '0',
        independentId: '0',
        independentNameId: '0',
      }),
    });

    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`登录响应异常：${r.text.slice(0, 120)}`);
    }
    if (!j.status) throw new Error(j.msg2 || j.mes || '登录失败（账号或密码错误）');

    await this.fetchUser();
    return this.user;
  }

  async fetchUser() {
    this.device = this.device || makeDeviceProfile(this.phone || 'anon');
    this.device.time_stamp = Date.now();
    const data = rsaEncryptDevice(JSON.stringify(this.device));

    const r = await this._call(URL_USER_INFO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ data }),
    });

    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`获取用户信息失败：HTTP ${r.status}`);
    }
    const msg = j.msg;
    if (!msg || typeof msg !== 'object' || !msg.puid) {
      throw new Error(`获取用户信息失败：${j.errorMsg || j.msg || '会话失效'}`);
    }

    this.user = {
      uid: msg.uid,
      fid: Number(msg.fid),
      name: msg.name,
      uname: msg.uname,
      puid: Number(msg.puid),
      pic: String(msg.pic || '').replace(/^http:/, 'https:'),
      clientId: msg.clientId || null,
      fidList: parseFidList(msg),
    };
    this.cidInfo = null;
    this.ensureCidInfo();
    return this.user;
  }

  // ------------------------------------------------ 课程 / 活动

  async getCourses() {
    const r = await this._call(URL_COURSE_LIST);
    if (r.status === 403) throw new Error('SESSION_EXPIRED');
    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`课程列表解析失败：HTTP ${r.status}`);
    }
    const list = j.channelList;
    if (!Array.isArray(list)) throw new Error(j.msg || '课程列表为空（会话可能已失效）');

    const out = [];
    for (const ch of list) {
      const content = ch && ch.content;
      if (!content || !content.course) continue;
      // 只认真课程；通知/群聊/专题等频道也带 content.course，会把课程数虚增
      if (ch.cataName !== '课程') continue;
      const arr = content.course.data;
      if (!Array.isArray(arr) || !arr.length) continue;
      const c = arr[0];
      out.push({
        courseId: Number(c.id),
        classId: Number(content.id),
        name: c.name || `课程${c.id}`,
        teacher: c.teacherfactor || '',
        school: c.schools || '',
        image: c.imageurl || '',
      });
    }
    return out;
  }

  /** 拉取某课程的活动列表；返回 { ext, list } */
  async getActivities(courseId, classId) {
    const url = `${URL_ACTIVE_LIST}&courseId=${encodeURIComponent(courseId)}&classId=${encodeURIComponent(classId)}`;
    const r = await this._call(url);
    if (r.status === 403) throw new Error('SESSION_EXPIRED');
    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`活动列表解析失败：HTTP ${r.status}`);
    }
    const data = j.data;
    if (!data) throw new Error(j.errorMsg || '活动列表为空');
    const ext = data.ext ? JSON.stringify(data.ext) : '';
    const raw = Array.isArray(data.activeList) ? data.activeList : [];
    const list = raw
      .filter((a) => SIGN_TYPES.has(Number(a.type)))
      .map((a) => ({
        activeId: Number(a.id),
        type: Number(a.type),
        activeType: Number(a.activeType),
        status: Number(a.status),
        startTime: Number(a.startTime),
        endTime: Number(a.endTime),
        name: a.nameOne || a.nameFour || '签到',
        otherId: a.otherId || '',
      }));
    return { ext, list, courseId, classId };
  }

  async getActiveInfo(activeId) {
    const r = await this._call(`${URL_ACTIVE_INFO}?activeId=${encodeURIComponent(activeId)}`);
    if (r.status === 403) throw new Error('SESSION_EXPIRED');
    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`签到信息解析失败：HTTP ${r.status}`);
    }
    const d = j.data;
    if (!d) throw new Error(j.errorMsg || j.msg || '签到信息为空（活动可能已结束）');
    return {
      locationLatitude: Number(d.locationLatitude) || 0,
      locationLongitude: Number(d.locationLongitude) || 0,
      locationRange: Number(d.locationRange) || 0,
      signInId: Number(d.signInId) || 0,
      signOutId: Number(d.signOutId) || 0,
      needAddress: Number(d.ifopenAddress) === 1,
      needFace: Number(d.openCheckFaceFlag) === 1,
      needCaptcha: Number(d.ifNeedVCode) === 1,
      raw: d,
    };
  }

  // ------------------------------------------------ 人脸

  /** 取本人档案里用于比对的人脸照片 objectId */
  async getProfileFaceObjectId() {
    const r = await this._call(URL_PROFILE_FACE);
    if (r.status === 403) throw new Error('SESSION_EXPIRED');
    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`人脸照片查询失败：HTTP ${r.status}`);
    }
    const id = j && j.data && j.data.oldObjectId;
    return id ? String(id) : null;
  }

  static faceImageUrl(objectId) {
    return URL_SHARED_IMAGE.replace('%s', objectId);
  }

  /**
   * 组装 faceResult 并换取 faceEnc。
   * LiveDetectionStatus / collectStatus 是客户端自报字段，服务端只校验 signToken。
   */
  async checkFace(activeId, objectId) {
    const cid = this.ensureCidInfo();
    const cxtime = String(Date.now());
    const fields = {
      currentFaceId: objectId,
      LiveDetectionStatus: '1',
      collectStatus: '1',
    };
    const face = {
      currentFaceId: objectId,
      LiveDetectionStatus: 1,
      collectStatus: 1,
      cxtime,
    };
    if (cid) {
      const signed = { ...fields, cxtime, cxcid: cid.cxcid };
      const raw = Object.keys(signed)
        .sort()
        .map((k) => k + signed[k])
        .join('');
      face.cxcid = cid.cxcid;
      face.signToken = md5(raw + cid.sc);
    }

    const url =
      `${URL_CHECK_FACE}&activeId=${encodeURIComponent(activeId)}` +
      `&faceResult=${encodeURIComponent(JSON.stringify(face))}`;
    const r = await this._call(url);
    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`人脸校验返回异常：${r.text.slice(0, 120)}`);
    }
    if (!j.enc) throw new Error(j.msg || j.errorMsg || '未拿到 faceEnc（人脸照片可能未通过）');
    return String(j.enc);
  }

  // ------------------------------------------------ 签到

  async preSign(activeId, courseId, classId, ext) {
    const url =
      `${URL_PRESIGN}?courseId=${encodeURIComponent(courseId)}&classId=${encodeURIComponent(classId)}` +
      `&activePrimaryId=${encodeURIComponent(activeId)}&general=1&sys=1&ls=1&appType=15` +
      `&uid=${encodeURIComponent(this.user.puid)}&isTeacherViewOpen=0`;
    const r = await this._call(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `https://mobilelearn.chaoxing.com/newsign/preSign?activePrimaryId=${activeId}`,
      },
      body: form({ ext: ext || '' }),
    });
    if (r.status === 403) throw new Error('SESSION_EXPIRED');
    await this.postAnalysis(activeId).catch(() => {});
    return r.text || '';
  }

  async postAnalysis(activeId) {
    const r = await this._call(`${URL_ANALYSIS}&aid=${encodeURIComponent(activeId)}`);
    const m = /code='\+'([a-f0-9]+)/.exec(r.text || '');
    if (!m) return;
    await this._call(`${URL_ANALYSIS2}&code=${encodeURIComponent(m[1])}`);
  }

  _jitter(base, range) {
    return base + (Math.random() * 2 - 1) * range;
  }

  /** 单次签到尝试 */
  async signOnce({
    activeId,
    courseId,
    classId,
    ext,
    place,
    objectId,
    tight = false,
    enc2 = null,
    qrEnc = null,
    signCode = null,
  }) {
    await this.preSign(activeId, courseId, classId, ext);

    const range = tight ? 0.00001 : 0.00005;
    const lat = Number(this._jitter(place.lat, range).toFixed(6));
    const lng = Number(this._jitter(place.lng, range).toFixed(6));
    const address = place.address || '';

    let faceEnc = null;
    let faceError = null;
    if (objectId) {
      try {
        faceEnc = await this.checkFace(activeId, objectId);
      } catch (e) {
        faceError = e.message;
      }
    }

    // 学习通要两个位置参数：
    //   location        —— 实时定位（不带 mockData）
    //   locationResult  —— 定位结果（带 mockData 标记）
    // 之前只发 locationResult，服务端拿不到 location 就会判定「不在签到范围内」。
    const locBase = { result: 1, latitude: lat, longitude: lng, address };
    const locationResult = JSON.stringify({
      ...locBase,
      mockData: JSON.stringify({ strategy: 0, probability: -1 }),
    });

    const params = {
      name: this.user.name,
      address,
      activeId: String(activeId),
      courseId: String(courseId),
      uid: String(this.user.puid),
      clientip: '',
      latitude: String(lat),
      longitude: String(lng),
      fid: String(this.user.fid),
      appType: '15',
      ifTiJiao: '1',
      deviceCode: this.deviceCode,
      vpProbability: '-1',
      vpStrategy: '',
      location: JSON.stringify(locBase),
      locationResult,
    };
    if (enc2) params.enc2 = enc2;
    // 扫码签到：enc 是现场二维码里的动态串，服务端认这个
    if (qrEnc) params.enc = qrEnc;
    // 签到码 / 手势签到：signCode 是老师设置的码或手势编码
    if (signCode) params.signCode = signCode;
    if (faceEnc) {
      params.currentFaceId = objectId;
      params.ifCFP = '0';
      params.faceEnc = faceEnc;
      params.faceCode = '';
      params.faceEncAid = '';
    }

    const r = await this._call(`${URL_SIGN}?${qs(params)}`, {
      headers: { Referer: 'https://mobilelearn.chaoxing.com/' },
    });
    const text = (r.text || '').trim();

    return this._interpret(text, { lat, lng, faceError, hasFace: !!objectId });
  }

  _interpret(text, meta) {
    if (text === 'success') return { ok: true, text, ...meta };
    if (text.includes('您已签到过了') || text === 'success2') {
      return { ok: true, already: true, text, ...meta };
    }
    if (text.startsWith('errorLocation')) {
      const d = text.split('_')[1];
      return { ok: false, kind: 'location', distance: d ? Number(d) : null, text, ...meta };
    }
    if (text.startsWith('checkFace_')) {
      return { ok: false, kind: 'face_enc', enc2: text.slice('checkFace_'.length), text, ...meta };
    }
    if (text.startsWith('validate_') || text.startsWith('validate')) {
      return { ok: false, kind: 'captcha', enc2: text.replace(/^validate_?/, ''), text, ...meta };
    }
    if (text.startsWith('[face]')) {
      return { ok: false, kind: 'face', text: text.replace('[face]', ''), ...meta };
    }
    if (text.includes('同一设备不允许重复签到')) {
      return { ok: false, kind: 'device', text, ...meta };
    }
    if (text.includes('签到已结束') || text.includes('下次早点哦')) {
      return { ok: false, kind: 'expired', text, ...meta };
    }
    return { ok: false, kind: 'unknown', text, ...meta };
  }

  /** 带自动收紧 & faceEnc 重试的完整签到 */
  async sign(args) {
    const attempts = [];
    let res = await this.signOnce(args);
    attempts.push(res);

    if (!res.ok && res.kind === 'location') {
      res = await this.signOnce({ ...args, tight: true });
      attempts.push(res);
    }
    if (!res.ok && res.kind === 'face_enc' && res.enc2) {
      res = await this.signOnce({ ...args, tight: true, enc2: res.enc2 });
      attempts.push(res);
    }
    return { ...res, attempts: attempts.map((a) => ({ ok: a.ok, kind: a.kind || 'ok', text: a.text })) };
  }

  // ------------------------------------------------ 云盘上传（自定义人脸照）

  async _cloudToken() {
    if (this._token) return this._token;
    const r = await this._call(URL_CLOUD_TOKEN);
    const j = JSON.parse(r.text || '{}');
    if (!j._token) throw new Error('云盘 token 获取失败');
    this._token = j._token;
    return this._token;
  }

  async uploadFaceImage(jpegBuffer) {
    const token = await this._cloudToken();
    const boundary = '----cx' + crypto.randomBytes(8).toString('hex');
    const filename = crypto.randomUUID() + '.jpg';
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="puid"\r\n\r\n${this.user.puid}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(head, 'utf8'), jpegBuffer, Buffer.from(tail, 'utf8')]);

    const r = await this._call(URL_CLOUD_UPLOAD + encodeURIComponent(token), {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
    });
    const j = JSON.parse(r.text || '{}');
    if (!j.objectId) throw new Error(j.msg || '人脸照上传失败');
    return String(j.objectId);
  }
}

/** 从一段 HTML 里取指定 id 的 input 的 value（不依赖 value/id 的先后顺序） */
function hiddenInput(html, id) {
  const tagRe = /<input\b[^>]*>/gi;
  const idRe = new RegExp(`\\bid=["']${id}["']`);
  let m;
  while ((m = tagRe.exec(html))) {
    if (!idRe.test(m[0])) continue;
    const v = /\bvalue=["']([^"']*)["']/.exec(m[0]);
    return v ? v[1] : '';
  }
  return null;
}

/**
 * 解析扫码签到的二维码内容。
 * 学习通两种格式：
 *   SIGNIN:<signDetail>&enc=<enc>-<随机尾巴>        （App 内部协议）
 *   http://xxx/signDetail?activeId=1&enc=xxx        （网页链接）
 */
function parseQrPayload(text) {
  const s = String(text || '').trim();
  if (!s) return { enc: null, activeId: 0 };

  if (s.startsWith('SIGNIN:')) {
    const content = s.slice(7).split('-')[0];
    const em = /[?&]enc=([^&]+)/.exec(content);
    const detail = content.split('&enc=')[0];
    const im = /[?&](?:activeId|id|aid)=(\d+)/.exec(detail);
    return {
      enc: em ? decodeURIComponent(em[1]) : null,
      activeId: im ? Number(im[1]) : 0,
    };
  }

  const em = /[?&]enc=([^&\s]+)/.exec(s);
  const im = /[?&](?:activeId|aid|id)=(\d+)/.exec(s);
  return {
    enc: em ? decodeURIComponent(em[1]) : null,
    activeId: im ? Number(im[1]) : 0,
  };
}

function parseFidList(msg) {
  const out = [];
  const raw = msg.fidList || msg.fidlist || msg.schools;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (Array.isArray(item) && item.length >= 2 && item[0] != null) {
        out.push([Number(item[0]), String(item[1] ?? '')]);
      } else if (item && typeof item === 'object' && item.fid != null) {
        out.push([Number(item.fid), String(item.name ?? '')]);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) out.push([Number(k), String(v)]);
  }
  if (!out.length && msg.fid != null) out.push([Number(msg.fid), '']);
  return out.filter((x) => Number.isFinite(x[0]));
}

module.exports = {
  Session,
  request,
  aesEncrypt,
  rsaDecryptClientId,
  makeDeviceProfile,
  randomDeviceCode,
  parseQrPayload,
  faceImageUrl: Session.faceImageUrl,
  SIGN_TYPES,
  UA,
};
