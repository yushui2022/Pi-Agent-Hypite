import {api} from './api.js';
import {escapeHTML as esc} from './components.js';
import {icon} from './icons.js';

const size = bytes => bytes < 1048576 ? Math.ceil(bytes / 1024) + ' KiB' : (bytes / 1048576).toFixed(1) + ' MiB';
export function scenarioCards(templates) {
  return `<div class="scenario-grid">${templates.map((t, i) => `<button class="scenario-card" data-template="${i}" aria-labelledby="scenario-title-${i}" aria-describedby="scenario-desc-${i}"><span class="scenario-visual"><img src="/assets/scenario-${esc(t.art)}-960.webp" srcset="/assets/scenario-${esc(t.art)}-480.webp 480w, /assets/scenario-${esc(t.art)}-960.webp 960w" sizes="(max-width: 760px) calc(100vw - 36px), (max-width: 1000px) calc(100vw - 242px), (max-width: 1440px) calc((100vw - 328px) / 3), 430px" width="960" height="640" loading="lazy" decoding="async" alt="${esc(t.name)}场景插图"></span><span class="scenario-copy"><strong id="scenario-title-${i}">${t.name}</strong><span id="scenario-desc-${i}">${t.desc}</span><small>带入创作要求 ${icon('arrow')}</small></span></button>`).join('')}</div>`;
}

export function mountHome({root, draft, file, signedIn, templates, onFile, onDraft, onSubmit, isCurrent}) {
  root.innerHTML = `<section class="creation-stage" aria-labelledby="creation-title"><div class="home-heading"><h1 id="creation-title">今天，想复刻什么灵感？</h1><p>上传参考视频，规划你的下一批创作。</p></div>
      <form id="creation-form" class="composer">
        <div class="composer-body">
        <div class="reference-column"><div class="reference-label"><h2>参考视频</h2><span>必选</span></div><div id="reference-drop" class="reference-drop">
          <input id="reference-file" class="sr-only" type="file" accept=".mp4,.webm,.mov" aria-label="选择参考视频" aria-describedby="reference-help reference-error">
          <div id="reference-empty" class="reference-empty"><span class="upload-symbol">${icon('upload')}</span><button type="button" id="choose-reference">添加参考视频</button><span>也可直接拖入文件</span></div>
          <div id="reference-selected" hidden><video id="reference-preview" controls preload="metadata" playsinline aria-label="所选参考视频的本地预览"></video><div class="reference-file-row"><div><strong id="reference-name"></strong><span id="reference-status"></span></div><button type="button" id="replace-reference">更换</button><button type="button" id="remove-reference" class="icon-button" aria-label="移除已选参考视频">${icon('close')}</button></div><p id="preview-error" class="preview-error" hidden>浏览器无法预览此视频编码。仍可导入，或换用 H.264 MP4 / VP9 WebM。</p></div>
        </div></div>
        <div class="composer-brief"><label class="brief-label" for="creation-prompt">你想怎样改编？ <span>选填</span></label><textarea id="creation-prompt" maxlength="2000" rows="2" placeholder="保留喜欢的镜头与节奏，换上你的商品、故事或文案…">${esc(draft)}</textarea><div class="brief-suggestions" role="group" aria-label="添加常用复刻要求"><button type="button" data-brief="替换为我的商品素材。">${icon('plus')}替换商品</button><button type="button" data-brief="调整字幕与结尾文案。">${icon('plus')}调整文案</button><button type="button" data-brief="保留参考视频的镜头节奏。">${icon('plus')}保留节奏</button></div></div>
        </div><p id="reference-error" class="form-error" role="alert" hidden></p>
        <div class="composer-bottom"><span class="composer-hint" id="reference-help">MP4、WebM、MOV · 最多 512 MiB</span><button id="create-project" class="primary">创建复刻项目 ${icon('arrow')}</button></div>
      </form><div class="upload-feedback" id="upload-feedback" role="status"></div>
      <div class="creation-caption"><details class="creation-help"><summary>了解复刻流程</summary><ol><li><strong>导入参考</strong><span>预览视频，记录想保留的画面与节奏。</span></li><li><strong>配置替换</strong><span>添加自己的素材与文案，标注替换位置。</span></li><li><strong>安排批次</strong><span>为不同素材组合保存独立版本。</span></li></ol></details></div>
    </section>
    <section class="discovery"><div class="section-heading"><div><h2>从一个场景开始</h2><p>选择方向，带入改编要求。</p></div><a href="#templates">全部场景 ${icon('arrow')}</a></div>${scenarioCards(templates)}</section>
    ${signedIn ? '<section class="recent-projects" aria-labelledby="recent-title"><div class="section-heading"><h2 id="recent-title">继续你的项目</h2><a href="#remix">查看全部项目</a></div><div id="recent-list" role="status"></div></section>' : ''}`;
  const $ = selector => root.querySelector(selector);
  let selected = file, objectURL = null, disposed = false, dragDepth = 0;
  const release = () => {
    const player = $('#reference-preview');
    player.onloadedmetadata = null; player.onerror = null;
    player.pause(); player.removeAttribute('src'); player.load();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
  };
  function showFile() {
    release();
    $('#reference-empty').hidden = !!selected;
    $('#reference-selected').hidden = !selected;
    $('#reference-drop').classList.toggle('has-file', !!selected);
    $('#preview-error').hidden = true;
    if (!selected) return;
    const current = selected, player = $('#reference-preview');
    $('#reference-name').textContent = current.name;
    $('#reference-status').textContent = size(current.size) + ' · 本地预览，尚未上传';
    objectURL = URL.createObjectURL(current);
    player.src = objectURL;
    player.onloadedmetadata = () => {
      if (selected !== current || disposed) return;
      const duration = Number.isFinite(player.duration) ? ' · ' + player.duration.toFixed(1) + ' 秒' : '';
      $('#reference-status').textContent = size(current.size) + duration + ' · 尚未上传';
    };
    player.onerror = () => { if (selected === current && objectURL && !disposed) $('#preview-error').hidden = false; };
  }
  function reject(message) {
    $('#reference-error').hidden = false;
    $('#reference-error').textContent = message;
    $('#reference-file').setAttribute('aria-invalid', 'true');
  }
  function choose(files) {
    if (!files.length) return;
    if (files.length !== 1) { reject('一次请选择一条参考视频。其他素材可在项目里批量添加。'); return; }
    const next = files[0];
    if (!/\.(mp4|webm|mov)$/i.test(next.name) || !next.size || next.size > 512 * 1024 * 1024) {
      reject('请选择非空且不超过 512 MiB 的 MP4、WebM 或 MOV。'); return;
    }
    $('#reference-error').hidden = true;
    $('#reference-file').removeAttribute('aria-invalid');
    $('#upload-feedback').replaceChildren();
    selected = next; onFile(next); showFile();
  }
  $('#choose-reference').onclick = $('#replace-reference').onclick = () => $('#reference-file').click();
  $('#reference-file').onchange = event => { choose([...event.target.files]); event.target.value = ''; };
  $('#remove-reference').onclick = () => {
    selected = null; onFile(null); showFile();
    $('#reference-error').hidden = true; $('#reference-file').removeAttribute('aria-invalid'); $('#choose-reference').focus();
  };
  const drop = $('#reference-drop');
  drop.ondragenter = event => { event.preventDefault(); dragDepth++; drop.classList.add('is-dragging'); };
  drop.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; };
  drop.ondragleave = event => { event.preventDefault(); if (--dragDepth <= 0) drop.classList.remove('is-dragging'); };
  drop.ondrop = event => { event.preventDefault(); dragDepth = 0; drop.classList.remove('is-dragging'); choose([...event.dataTransfer.files]); };
  $('#creation-prompt').oninput = event => onDraft(event.target.value);
  root.querySelectorAll('[data-brief]').forEach(button => button.onclick = () => {
    const input = $('#creation-prompt'), phrase = button.dataset.brief;
    if (!input.value.includes(phrase)) {
      const next = [input.value.trim(), phrase].filter(Boolean).join(' ');
      if (next.length <= input.maxLength) { input.value = next; onDraft(next); }
    }
    input.focus();
  });
  $('#creation-form').onsubmit = event => {
    event.preventDefault();
    if (!selected) { reject('请先选择一条参考视频，再创建项目。'); $('#choose-reference').focus(); return; }
    $('#reference-preview').pause();
    onSubmit();
  };
  showFile();
  async function recent() {
    const target = $('#recent-list');
    target.innerHTML = '<p class="recent-message">正在读取项目…</p>';
    try {
      const projects = await api('/api/remix');
      if (disposed || !isCurrent()) return;
      const list = projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
      target.innerHTML = list.length ? `<div class="recent-grid">${list.map(p => `<a class="recent-project" href="#remix/${p.id}"><span class="recent-project-icon">${icon('folder')}</span><div><strong>${esc(p.title)}</strong><span>${p.assets} 份素材 · ${p.batches} 个批次</span></div>${icon('arrow')}</a>`).join('')}</div>` : '<p class="recent-message">还没有项目。导入上方的参考视频，建立你的第一个复刻项目。</p>';
    } catch (error) {
      if (disposed || !isCurrent()) return;
      target.innerHTML = `<div class="recent-message"><span>${esc(error.message)}</span><button type="button" id="retry-recent">重新加载</button></div>`;
      $('#retry-recent').onclick = recent;
    }
  }
  if (signedIn) recent();
  return () => { disposed = true; release(); };
}
