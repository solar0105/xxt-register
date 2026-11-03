'use strict';
/** 网络：真实网卡地址 + 地址文件 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const VIRTUAL_IFACE =
  /virtual|vmware|virtualbox|hyper-?v|vethernet|tailscale|zerotier|wsl|loopback|bluetooth|wi-?fi ?direct|\bdocker\b|\btap\b|\btun\b|\bvpn\b|hamachi|radmin/i;

/** 只回真实网卡的地址：剔除 APIPA(169.254) 与虚拟网卡 */
function lanIPs() {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (ni.address.startsWith('169.254.')) continue;
      const virtual = VIRTUAL_IFACE.test(iface);
      out.push({ iface, address: ni.address, virtual });
    }
  }
  out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
  return out;
}

let lastSig = '';

/**
 * 把当前可访问地址写到文件里。
 * 换 Wi-Fi / 重连热点会换 IP，记住的旧地址就打不开了 —— 有这个文件就能随时查到最新的。
 */
function writeAddressFile(port) {
  const real = lanIPs().filter((x) => !x.virtual);
  const sig = real.map((x) => x.address).join(',');
  if (sig === lastSig) return;
  lastSig = sig;

  const lines = [
    '学习通签到助手 · 当前访问地址',
    '（每次换网络后这个文件会自动更新，打不开就回来重新看一眼）',
    '',
    `手机/同网设备：${
      real.length
        ? real.map((x) => `http://${x.address}:${port}`).join('\n              ')
        : '（没有可用网卡，检查 Wi-Fi 是否连上）'
    }`,
    `本机：        http://127.0.0.1:${port}`,
    '',
    `更新时间：${new Date().toLocaleString('zh-CN')}`,
  ].join('\n');

  for (const dir of [ROOT, path.join(os.homedir(), 'Desktop')]) {
    try {
      if (!fs.existsSync(dir)) continue;
      fs.writeFileSync(path.join(dir, '学习通签到-当前地址.txt'), lines, 'utf8');
    } catch {
      /* 桌面没权限就算了，项目目录那份足够 */
    }
  }
}

module.exports = { lanIPs, writeAddressFile };
