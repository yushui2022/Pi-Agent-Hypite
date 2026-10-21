const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const option = (value, label, selected) => `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`;

export function mountBatchEditor({root, project, source, guard, save, toast}) {
  const plan = source?.plan || project.plan;
  const container = root.querySelector('#batch-editor');
  let requestId = crypto.randomUUID(), sequence = 0;
  container.innerHTML = `<form id="remix-batch-form" class="remix-batch"><h2>${source ? '基于已有批次新建' : '新批次'}</h2>
    ${source ? `<p class="muted">沿用「${escape(source.title)}」的方案快照与版本，可调整素材和文案；原批次保持不变。</p>` : ''}
    <label>批次名称<input name="title" required maxlength="120" value="${source ? escape((source.title + ' · 新版本').slice(0, 120)) : ''}" placeholder="例如：商品演示 · 第一批"></label>
    <p class="muted">每行对应一个版本；留空的替换项沿用方案设置。新批次最多 20 个版本。</p>
    <div id="variant-list"></div><div class="preparation-actions"><button type="button" id="add-variant">增加一条变体</button><span data-variant-count role="status"></span></div>
    <p data-batch-error class="error" role="alert"></p>
    <div class="account-save"><span id="save-status">有未保存的修改</span><button class="primary">保存批次计划</button></div></form>`;
  const form = container.querySelector('form'), list = form.querySelector('#variant-list');
  const error = form.querySelector('[data-batch-error]');
  const count = () => list.children.length;
  function changed() {
    requestId = crypto.randomUUID(); guard.setDirty(true);
    form.querySelector('[data-variant-count]').textContent = `${count()} / 20 个版本`;
    form.querySelector('#add-variant').disabled = count() >= 20;
    form.querySelectorAll('[data-copy-variant]').forEach(button => button.disabled = count() >= 20);
  }
  function read(section) {
    return {label: section.querySelector('[data-label]').value, overrides: Object.fromEntries(
      [...section.querySelectorAll('[data-override]')].filter(input => input.value).map(input => [plan.rows[Number(input.dataset.override)].key, input.value]))};
  }
  function add(initial = {}) {
    sequence++;
    const section = document.createElement('section'); section.className = 'remix-variant';
    section.innerHTML = `<label>变体名称<input data-label required maxlength="120" value="${escape(initial.label || `变体 ${sequence}`)}"></label>` +
      plan.rows.map((row, index) => {
        const value = initial.overrides && Object.hasOwn(initial.overrides, row.key) ? initial.overrides[row.key] : '';
        return `<label>${escape(row.key)} · ${({video:'视频',image:'图片',audio:'音频',text:'字幕'})[row.type] || escape(row.type)}${row.type === 'text' ?
          `<textarea data-override="${index}" rows="2" maxlength="2000" placeholder="留空沿用默认文案">${escape(value)}</textarea>` :
          `<select data-override="${index}">${option('', '沿用默认素材', value)}${project.assets.filter(asset => asset.mime.startsWith(row.type + '/')).map(asset => option(asset.id, asset.name, value)).join('')}</select>`}</label>`;
      }).join('') + '<div class="preparation-actions"><button type="button" data-copy-variant>复制此版本</button><button type="button" data-delete-variant>移除此版本</button></div>';
    list.append(section);
    section.querySelector('[data-delete-variant]').onclick = () => { section.remove(); changed(); };
    section.querySelector('[data-copy-variant]').onclick = () => {
      if (count() >= 20) return;
      const value = read(section); add({...value, label: (value.label.slice(0, 113) + ' · 副本')}); changed();
      list.lastElementChild.querySelector('input').focus();
    };
  }
  if (source) for (const variant of source.variants) {
    add({label: variant.label, overrides: Object.fromEntries(plan.rows.map(row => {
      const saved = variant.rows.find(item => item.key === row.key);
      return [row.key, saved ? (row.type === 'text' ? saved.value : saved.assetId) : ''];
    }))});
  } else add();
  changed(); form.oninput = changed;
  form.querySelector('#add-variant').onclick = () => { if (count() < 20) { add(); changed(); list.lastElementChild.querySelector('input').focus(); } };
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = '';
    if (count() < 1 || count() > 20) { error.textContent = '请保留 1–20 个版本后保存；原有批次不受影响。'; return; }
    const body = {requestId, title: form.elements.title.value, variants: [...list.children].map(read), revision: project.revision, ...(source ? {sourceBatchId: source.id} : {})};
    if (new TextEncoder().encode(JSON.stringify(body)).length > 60000) { error.textContent = '本批计划内容过长，请拆分为较小批次'; return; }
    try { await save(body); toast(source ? '新批次已保存，原批次保持不变' : '批次计划已保存'); }
    catch (failure) { if (container.isConnected) error.textContent = failure.message; }
  };
  form.elements.title.focus();
}
