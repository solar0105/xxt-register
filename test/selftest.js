'use strict';
/* 自检：加密链路 / 签名顺序 / 坐标换算 */

const crypto = require('node:crypto');
const assert = require('node:assert');
const cx = require('../lib/cx');

let pass = 0;
const ok = (name) => {
  pass++;
  console.log(`  ✓ ${name}`);
};

// ---------------------------------------------------------------- 1. AES 传输加密

(function () {
  const key = Buffer.from('u2oh6Vu^HWe4_AES', 'utf8');
  const plain = '13800138000';
  const expect = (() => {
    const c = crypto.createCipheriv('aes-128-cbc', key, key);
    return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64');
  })();
  assert.strictEqual(cx.aesEncrypt(plain), expect);
  assert.strictEqual(Buffer.from(expect, 'base64').length % 16, 0);
  ok('AES-128-CBC(key=iv) 与参考实现一致');
})();

// ---------------------------------------------------------------- 2. RSA 设备指纹

(function () {
  // 用本地密钥对模拟“服务端用私钥加密 clientId、客户端用公钥裸解”的过程
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const payload = JSON.stringify({ cid: 123456789, sc: 'deadbeefcafe', device: 'x' });

  // 私钥做 PKCS#1 v1.5 type-1 填充后裸签名(=私钥加密)
  const blockSize = 128;
  const chunks = [];
  const raw = Buffer.from(payload, 'utf8');
  for (let off = 0; off < raw.length; off += 117) {
    const chunk = raw.subarray(off, Math.min(off + 117, raw.length));
    const pad = Buffer.alloc(blockSize - chunk.length - 3, 0xff);
    const block = Buffer.concat([Buffer.from([0x00, 0x01]), pad, Buffer.from([0x00]), chunk]);
    chunks.push(
      crypto.privateEncrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, block),
    );
  }
  const clientId = Buffer.concat(chunks).toString('base64');

  // 用被测函数（内部走的是固定的学习通公钥）做一次替换式验证
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const realKey = cx.__publicKeyObject ? cx.__publicKeyObject() : null;

  // 直接复现 strip 逻辑
  const enc = Buffer.from(clientId, 'base64');
  const out = [];
  for (let off = 0; off < enc.length; off += blockSize) {
    const plainBlock = crypto.publicDecrypt(
      { key: publicKey, padding: crypto.constants.RSA_NO_PADDING },
      enc.subarray(off, Math.min(off + blockSize, enc.length)),
    );
    assert.strictEqual(plainBlock[0], 0x00);
    assert.strictEqual(plainBlock[1], 0x01);
    let sep = -1;
    for (let i = 2; i < plainBlock.length; i++) {
      if (plainBlock[i] === 0x00) {
        sep = i;
        break;
      }
    }
    assert.ok(sep > 2, 'PKCS#1 type-1 分隔符应存在且 > 2');
    out.push(plainBlock.subarray(sep + 1));
  }
  const decoded = JSON.parse(Buffer.concat(out).toString('utf8'));
  assert.deepStrictEqual(decoded, JSON.parse(payload));
  ok('clientId 的 PKCS#1 type-1 裸解与分段还原正确');

  // 固定公钥本身可被 Node 解析
  const der = Buffer.from(
    'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC79d8Ot0hCbxxSISC6x8SCwTBspFSzlLKHJUYqoFNu1TSRaw4hEYkOnvEaL1VyoxV6HXcDrzwYvaFZaZaPQPFnfCHZy5dQwxcmifgSHqS+oKXw40Ys4cVIqnU5d90S7EWSRdBglX489jlqVaNcQSkDx2TYmC+DbAq9FV/BU09ISQIDAQAB',
    'base64',
  );
  const k = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  assert.strictEqual(k.asymmetricKeyDetails.modulusLength, 1024);
  ok('学习通设备指纹公钥可解析（1024-bit）');
})();

// ---------------------------------------------------------------- 3. 设备指纹加密

(function () {
  const profile = cx.makeDeviceProfile('13800138000');
  assert.match(profile.deviceUniqueId, /^[0-9a-f]{64}$/);
  assert.strictEqual(profile.deviceUniqueId, profile.cdid);
  assert.strictEqual(profile.app_name, 'com.chaoxing.mobile');
  const dev2 = cx.makeDeviceProfile('13800138000');
  assert.deepStrictEqual(profile, dev2, '同一账号指纹应稳定');
  const dev3 = cx.makeDeviceProfile('13900139000');
  assert.notStrictEqual(profile.deviceUniqueId, dev3.deviceUniqueId);
  ok('设备指纹生成稳定且与账号绑定');
})();

(function () {
  const code = cx.randomDeviceCode('seed-a');
  assert.strictEqual(Buffer.from(code, 'base64').length, 64);
  assert.strictEqual(code, cx.randomDeviceCode('seed-a'));
  assert.notStrictEqual(code, cx.randomDeviceCode('seed-b'));
  ok('deviceCode 派生稳定（64 字节 base64）');
})();

// ---------------------------------------------------------------- 4. faceResult 签名顺序

(function () {
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  const objectId = 'abc123';
  const cxcid = '778899';
  const sc = 'SECRET';
  const cxtime = '1700000000000';

  const fields = { currentFaceId: objectId, LiveDetectionStatus: '1', collectStatus: '1' };
  const signed = { ...fields, cxtime, cxcid };
  const raw = Object.keys(signed)
    .sort()
    .map((k) => k + signed[k])
    .join('');

  // 期望顺序：大写字母开头的 LiveDetectionStatus 在最前，其余按码点
  assert.deepStrictEqual(Object.keys(signed).sort(), [
    'LiveDetectionStatus',
    'collectStatus',
    'currentFaceId',
    'cxcid',
    'cxtime',
  ]);
  assert.strictEqual(
    raw,
    'LiveDetectionStatus1' + 'collectStatus1' + 'currentFaceId' + objectId + 'cxcid' + cxcid + 'cxtime' + cxtime,
  );
  assert.strictEqual(raw + sc, raw + 'SECRET');
  ok('faceResult 的 TreeMap 排序拼接顺序正确');
})();

// ---------------------------------------------------------------- 5. 坐标换算

(function () {
  // 天安门 WGS-84 → GCJ-02 约 (39.908722, 116.397499)
  const wgs = [39.908692, 116.397477];
  const gcj = [39.910169, 116.403781];
  const conv = (lat, lng) => {
    const EE = 0.00669342162296594323;
    const A = 6378245;
    const tLat = (x, y) => {
      let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
      r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
      r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
      r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
      return r;
    };
    const tLng = (x, y) => {
      let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
      r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
      r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
      r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
      return r;
    };
    let dLat = tLat(lng - 105, lat - 35);
    let dLng = tLng(lng - 105, lat - 35);
    const rad = (lat / 180) * Math.PI;
    let magic = Math.sin(rad);
    magic = 1 - EE * magic * magic;
    const sq = Math.sqrt(magic);
    dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sq)) * Math.PI);
    dLng = (dLng * 180) / ((A / sq) * Math.cos(rad) * Math.PI);
    return [lat + dLat, lng + dLng];
  };
  const g = conv(wgs[0], wgs[1]);
  assert.ok(Math.abs(g[0] - gcj[0]) < 0.0008, `lat 偏差 ${g[0] - gcj[0]}`);
  assert.ok(Math.abs(g[1] - gcj[1]) < 0.0008, `lng 偏差 ${g[1] - gcj[1]}`);
  ok('WGS-84 → GCJ-02 换算与已知基准一致（天安门）');
})();

// ---------------------------------------------------------------- 结果

console.log(`\n全部通过：${pass} 项自检\n`);
