/* 地点页 + 地图 */
// ---------------------------------------------------------------- 地点页

function renderPlaces() {
  const st = S.state;
  const places = st.places || [];
  let h = `
  <div class="card">
    <h3>选择签到坐标 <span class="sub">拖动地图，十字准星即取点</span></h3>
    <div class="mapwrap">
      <div id="map"><div class="crosshair"><i></i></div></div>
      <div class="map-hint" id="mapHint">加载地图…</div>
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <button class="grow" data-act="locate">◎ 定位到我</button>
    </div>
    <p class="tiny muted" id="locateHint" style="margin:8px 0 0"></p>
    <div class="row" style="margin-top:10px;gap:8px">
      <label class="field grow" style="margin:0"><span>纬度</span><input id="pLat" inputmode="decimal" placeholder="26.000000"></label>
      <label class="field grow" style="margin:0"><span>经度</span><input id="pLng" inputmode="decimal" placeholder="119.000000"></label>
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <label class="field grow" style="margin:0">
        <span>坐标基准（提交给学习通的格式）</span>
        <select id="pDatum">
          <option value="bd09">BD-09 百度（默认，与可用方案一致）</option>
          <option value="gcj02">GCJ-02 高德／火星</option>
          <option value="wgs84">WGS-84 原始 GPS</option>
        </select>
      </label>
    </div>
    <label class="field" style="margin-top:10px"><span>地点名称</span><input id="pName" placeholder="如：一教 A201"></label>
    <div class="row">
      <button class="grow primary" data-act="save-place">保存为常用地点</button>
    </div>
    <p class="tiny muted" style="margin:10px 0 0">
      提示：地图底图是 GCJ-02。若目标就在老师的签到点上，用「签到」页的「取点」最保险——直接复用服务端下发的坐标，不作任何换算。
    </p>
  </div>`;

  h += `<div class="card"><h3>常用地点 <span class="sub">${places.length} 个</span></h3>`;
  if (!places.length) {
    h += '<div class="empty">还没有保存的地点</div>';
  } else {
    h += '<div class="list">';
    places.forEach((p, i) => {
      h += `
      <div class="item">
        <div class="grow">
          <div class="title">${esc(p.name)} ${i === 0 ? '<span class="badge accent">默认</span>' : ''}</div>
          <div class="desc mono">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>
        </div>
        ${i === 0 ? '' : `<button class="small ghost" data-act="promote-place" data-id="${p.id}">设为默认</button>`}
        <button class="small danger" data-act="del-place" data-id="${p.id}">删除</button>
      </div>`;
    });
    h += '</div>';
  }
  h += '</div>';
  return h;
}

/** 先保证 Leaflet 到位再挂地图（首次进「地点」页才加载 147KB 的底图库） */
async function mountMapAsync() {
  const el = $('#map');
  if (!el) return;
  if ($('#mapHint')) $('#mapHint').textContent = '加载底图…';
  try {
    const ready = await ensureLeaflet();
    if (!ready) throw new Error('leaflet missing');
  } catch {
    if ($('#mapHint')) $('#mapHint').textContent = '底图库加载失败 · 可直接手填经纬度';
    return;
  }
  if (!document.getElementById('map')) return; // 期间切走了
  mountMap();
}

function mountMap() {
  const el = $('#map');
  if (!el) return;
  if (S.map && S.mapContainer === el) {
    S.map.invalidateSize();
    syncMapFromInputs();
    return;
  }
  if (S.map) {
    S.map.remove();
    S.map = null;
  }
  const hasAnchor = S.tempPoint || S.state.places[0] || S.lastFix;
  const start = S.tempPoint
    ? toGcj(S.tempPoint.lat, S.tempPoint.lng, S.tempPoint.datum || S.datum)
    : S.state.places[0]
      ? toGcj(S.state.places[0].lat, S.state.places[0].lng, S.datum)
      : S.lastFix || DEFAULT_CENTER;

  const map = L.map(el, { zoomControl: true, attributionControl: false }).setView(
    start,
    hasAnchor ? 17 : 13,
  );
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    subdomains: '1234',
    maxZoom: 19,
  }).addTo(map);

  map.on('move', () => {
    const c = map.getCenter();
    $('#pLat').value = c.lat.toFixed(6);
    $('#pLng').value = c.lng.toFixed(6);
    $('#mapHint').textContent = `GCJ-02 ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
  });
  map.on('moveend', () => {
    const c = map.getCenter();
    const [la, ln] = fromGcj(c.lat, c.lng, S.datum);
    $('#pLat').value = la.toFixed(6);
    $('#pLng').value = ln.toFixed(6);
  });

  S.map = map;
  S.mapContainer = el;
  const c = map.getCenter();
  $('#pLat').value = c.lat.toFixed(6);
  $('#pLng').value = c.lng.toFixed(6);
  $('#mapHint').textContent = '拖动地图取点';
  $('#pDatum').value = S.datum;
  setTimeout(() => map.invalidateSize(), 60);

  // 没有任何参照点时，自动尝试定位一次（HTTP 下会被浏览器拒绝，那就只能手动拖）
  if (!hasAnchor) {
    locateTo(map).catch((e) => {
      const h = $('#locateHint');
      if (h) h.textContent = e.message;
      if ($('#mapHint')) $('#mapHint').textContent = '未定位 · 拖到你的学校';
    });
  } else {
    const h = $('#locateHint');
    if (h && !window.isSecureContext) {
      h.textContent = '当前是 http，浏览器不给定位权限；直接拖动地图即可。';
    }
  }
}

/** 定位并把地图移到那里。返回 WGS-84 原始坐标 */
async function locateTo(map) {
  const fix = await getBrowserFix();
  const [gla, gln] = wgsToGcj(fix.lat, fix.lng);
  S.lastFix = [gla, gln];
  map.setView([gla, gln], 18);
  const h = $('#locateHint');
  if (h) {
    h.textContent = `已定位（精度约 ${Math.round(fix.acc || 0)} 米）。拖动地图微调，十字准星就是取点。`;
  }
  return fix;
}

/** 手动改经纬度 → 地图跟随（按当前基准解释） */
function syncMapFromInputs() {
  const lat = parseFloat($('#pLat').value);
  const lng = parseFloat($('#pLng').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !S.map) return;
  const [gla, gln] = toGcj(lat, lng, S.datum);
  if (Math.abs(S.map.getCenter().lat - gla) > 1e-6 || Math.abs(S.map.getCenter().lng - gln) > 1e-6) {
    S.map.setView([gla, gln]);
  }
}
