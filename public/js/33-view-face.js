/* 人脸页 */
// ---------------------------------------------------------------- 人脸页

function renderFace() {
  const f = S.state.face;
  let h = `
  <div class="card">
    <h3>人脸校验 <span class="sub">活体结果由客户端声明</span></h3>`;
  if (f.objectId) {
    h += `
    <div class="row" style="align-items:flex-start">
      <div style="position:relative;width:104px;height:104px;flex:none;border-radius:12px;overflow:hidden;
                  border:1px solid var(--line);background:linear-gradient(135deg,#243047,#1a2032);
                  display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted)">
        <span style="position:absolute;z-index:0;font-size:26px;opacity:.5">☺</span>
        <img src="${esc(`https://p.cldisk.com/star4/${f.objectId}/origin.jpg`)}" alt="人脸照"
             style="position:relative;z-index:1;width:100%;height:100%;object-fit:cover"
             onerror="this.remove()">
      </div>
      <div class="grow">
        <div class="tiny muted">objectId</div>
        <div class="mono" style="word-break:break-all">${esc(f.objectId)}</div>
        <div class="row wrap" style="margin-top:8px;gap:6px">
          <span class="badge ok">已配置</span>
          <span class="badge">${esc(f.source === 'archive' ? '本人档案照' : f.source === 'upload' ? '上传到云盘' : '手动指定')}</span>
          <span class="badge">${f.updatedAt ? ago(f.updatedAt) : ''}</span>
        </div>
      </div>
    </div>`;
  } else {
    h += `<div class="empty">还没有人脸照片，签到会被人脸校验拦下</div>`;
  }

  h += `
  <div class="sep"></div>
  <div class="row wrap" style="gap:8px">
    <button class="grow primary" data-act="face-refresh">从本人档案拉取</button>
  </div>
  <div class="row wrap" style="gap:8px;margin-top:8px">
    <button class="grow" data-act="face-upload">选一张照片上传</button>
  </div>
  <input type="file" id="faceFile" accept="image/*" style="display:none">

  <details style="margin-top:14px">
    <summary class="tiny muted">手动填写 objectId</summary>
    <div class="row" style="margin-top:8px;gap:8px">
      <input id="faceObjectId" class="grow mono" placeholder="例如 1a2b3c4d…">
      <button class="small" data-act="face-manual">保存</button>
    </div>
  </details>
  <p class="tiny muted" style="margin:12px 0 0">
    「档案照」是学校当初采集、学习通存着用来跟你比对的那张照片——用它成功率最高。
    上传的照片会先存进你的学习通云盘，再用其 objectId 作为 currentFaceId。
  </p>
  </div>`;
  return h;
}
