/* 手机访问入口卡片 */
// ---------------------------------------------------------------- 手机入口

/** 仅在本机打开时显示：给手机访问的入口 + 连不上怎么救 */
function renderPhoneCard() {
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(location.hostname);
  const all = (S.state.server && S.state.server.ips) || [];
  const ips = all.filter((x) => !x.virtual);
  if (!isLocal || !ips.length) return '';

  const port = location.port || '8686';
  const hasQR = typeof qrcode !== 'undefined';
  if (!hasQR) {
    // 二维码库按需加载，加载完再重画一次
    ensureQR().then((ok) => ok && S.tab === 'sign' && render()).catch(() => {});
  }

  const figs = ips
    .map((x) => {
      const url = `http://${x.address}:${port}/`;
      return `<figure>
        ${hasQR ? qrSvg(url) : '<div style="width:110px;height:110px;border-radius:10px;background:#fff;color:#888;display:flex;align-items:center;justify-content:center;font-size:12px">生成中</div>'}
        <figcaption>${esc(url)}</figcaption>
      </figure>`;
    })
    .join('');

  const other = all.filter((x) => x.virtual).map((x) => `${x.address}（${esc(x.iface)}）`);

  return `
  <div class="card">
    <h3>手机打开 <span class="sub">手机连同一个 Wi-Fi</span></h3>
    <div class="qrbox">${figs}</div>
    <p class="tiny muted" style="margin:10px 0 0">
      扫不出来就直接在手机浏览器里手打上面那行地址。
      ${S.state.server.pinRequired ? '已设访问口令，首次进入要输一次。' : ''}
      ${other.length ? `<br>已忽略虚拟网卡：${other.join('、')}` : ''}
    </p>
    <details style="margin-top:12px">
      <summary class="tiny" style="color:var(--warn)">手机打不开 / 一直转圈？点这里</summary>
      <div class="tiny muted" style="margin-top:10px;line-height:1.75">
        <b style="color:var(--fg)">先自测一次</b><br>
        手机浏览器打开 <span class="mono">http://${ips[0].address}:${port}/ping</span><br>
        显示 <span class="mono">pong</span> = 通的，问题在前端缓存，刷新即可；<br>
        一直转圈/报错 = 网络根本没通，看下面三条。<br><br>

        <b style="color:var(--fg)">原因（按概率排序）</b><br>
        1. <b>校园网/公司 Wi-Fi 开了客户端隔离</b>——同一 Wi-Fi 下设备也互相看不见，最常见<br>
        2. 手机在流量上，没连 Wi-Fi<br>
        3. 连的是不同 Wi-Fi / 不同频段的不同 SSID<br><br>

        <b style="color:var(--fg)">三个能绕过的办法</b><br>
        <b>A. 手机开热点，电脑连热点</b>（最快，2 分钟）<br>
        手机「个人热点」打开 → 电脑连上 → 重启 start.bat → 看终端打印的新 IP，一般是 192.168.43.x<br><br>
        <b>B. 数据线 + USB 反向代理</b>（不依赖 Wi-Fi）<br>
        手机开「USB 调试」，电脑装 adb 后执行：<br>
        <span class="mono">adb reverse tcp:${port} tcp:${port}</span><br>
        然后手机浏览器打开 <span class="mono">http://127.0.0.1:${port}</span><br><br>
        <b>C. 直接在手机上跑</b>（最省心，彻底不要电脑）<br>
        用 Termux 执行 <span class="mono">bash termux-setup.sh</span>，见 README 方案②
      </div>
    </details>
  </div>`;
}

function qrSvg(text, cell = 4) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(cell, 2);
  } catch {
    return '';
  }
}
