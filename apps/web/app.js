import { mountAgent } from './agent.js';
import { normalizeListState, selectJobs, parseView } from './workspace-state.js';
import { api } from './api.js';
import { initTheme, createEditGuard } from './ui.js';
initTheme();
const guard = createEditGuard();
let viewRequest = 0;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let savedList = {}; try { savedList = JSON.parse(sessionStorage.getItem('workspace-list') || '{}') || {}; } catch {}
let { filter, query, sort } = normalizeListState(savedList);
let jobs = [], current = null;
let activeHash = location.hash || '#tasks';
function rememberList() { try { sessionStorage.setItem('workspace-list', JSON.stringify({filter,query,sort})); } catch {} }
function commitView(hash) { activeHash = hash; history.replaceState(null, '', hash); }
function cancelNavigation() { history.replaceState(null, '', activeHash); }
function toast(text) { $('#message').textContent = text; $('#message').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#message').hidden = true, 5000); }
function nav(service = false) { if(service) $('#nav-count').hidden=true; $('#tasks-nav').classList.toggle('active', !service); $('#services-nav').classList.toggle('active', service); $('#breadcrumb').textContent = service ? '服务连接' : '制作任务'; }
const date = s => new Date(s).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function openCreate() { guard.setDirty(false); $('#form-error').textContent = ''; $('#create-dialog').showModal(); }
async function list() {
  if (!await guard.canLeave()) { cancelNavigation(); return; }
  const request = ++viewRequest;
  commitView('#tasks'); current = null; nav(); $('#content').innerHTML = '<div class="loading">正在读取任务…</div>';
  try { const data = await api('/api/jobs'); if (request !== viewRequest) return; jobs = data; $('#nav-count').textContent = jobs.length; $('#nav-count').hidden=false; renderList(); }
  catch(e) { if (request !== viewRequest) return; $('#content').innerHTML = `<div class="empty"><h2>暂时无法读取任务</h2><p>${esc(e.message)}</p><button id="retry">重新加载</button></div>`; $('#retry').onclick = list; }
}
function renderList() {
  $('#content').innerHTML = `<div class="page-heading"><div><p class="eyebrow">PRODUCTION DESK</p><h1>制作任务</h1><p class="muted">管理制作需求、参考资料与工程检查。</p></div><button id="new-job" class="primary">＋ 新建任务</button></div>
  <div class="metrics"><div class="metric"><span>全部任务</span><strong>${jobs.length.toString().padStart(2,'0')}</strong><small>所有制作计划</small></div><div class="metric"><span>需求准备中</span><strong>${jobs.filter(j=>!j.technicalSample).length.toString().padStart(2,'0')}</strong><small>可以随时补充和修改</small></div><div class="metric"><span>已交付视频</span><strong>—</strong><small>接通制作服务后开始生产</small></div></div>
  <div class="notice"><div><h3>制作服务待连接</h3><p>当前可管理需求与检查工程，视频生成将在服务接通后启用。</p></div><button id="view-services" class="text-button">查看服务状态 →</button></div>
  <div class="toolbar"><div class="filters"><button class="filter ${filter==='all'?'selected':''}" data-filter="all" aria-pressed="${filter==='all'}">全部任务</button><button class="filter ${filter==='production'?'selected':''}" data-filter="production" aria-pressed="${filter==='production'}">制作需求</button><button class="filter ${filter==='sample'?'selected':''}" data-filter="sample" aria-pressed="${filter==='sample'}">技术样例</button></div><div class="list-tools"><select id="sort" aria-label="任务排序"><option value="newest">最新创建</option><option value="oldest">最早创建</option><option value="title">任务名称</option></select><input id="search" class="search" type="search" placeholder="搜索任务、账号或商品" aria-label="搜索任务" value="${esc(query)}"></div></div><div class="list-summary"><span id="result-count" role="status"></span><button class="text-button" id="clear-filters">清除筛选</button></div><div id="results"></div>`;
  $('#new-job').onclick = openCreate; $('#view-services').onclick = services;
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; rememberList(); renderList(); });
  $('#search').oninput = e => { query = e.target.value; rememberList(); renderRows(); };
  $('#sort').value=sort; $('#sort').onchange=e=>{sort=e.target.value;rememberList();renderRows();};
  $('#clear-filters').onclick=()=>{filter='all';query='';rememberList();renderList();$('#search').focus();};
  renderRows();
}
function renderRows() {
  const visible = selectJobs(jobs,{filter,query,sort});
  $('#result-count').textContent=`显示 ${visible.length} / ${jobs.length} 个任务`;
  $('#clear-filters').hidden=filter==='all'&&!query;
  $('#results').innerHTML = visible.length ? `<div class="table-wrap"><table><thead><tr><th>制作任务</th><th>账号 / 项目</th><th>语言</th><th>状态</th><th>创建时间</th><th></th></tr></thead><tbody>${visible.map(j=>`<tr><td><button class="job-title" data-job="${j.id}">${esc(j.title)}</button><div class="subline">${j.brief.references.length ? `${j.brief.references.length} 条参考已记录` : '参考素材待补充'}</div></td><td data-label="账号 / 项目">${esc(j.brief.account)}</td><td data-label="语言">${esc(j.brief.language)}</td><td data-label="状态"><span class="badge ${j.technicalSample?'sample':''}">${j.technicalSample?'技术样例':'需求准备中'}</span></td><td data-label="创建时间" class="muted">${date(j.createdAt)}</td><td><button class="text-button" data-job="${j.id}" aria-label="打开 ${esc(j.title)}">→</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="panel empty"><div class="empty-mark">↗</div><h2>${jobs.length?'没有匹配的任务':'为下一条视频，留一个起点'}</h2><p>${jobs.length?'试试其他关键词或筛选条件。':'写下商品、受众和制作方向。现在还不需要素材或视频 API。'}</p>${jobs.length?'':'<button id="first-job" class="primary">创建第一条任务</button>'}</div>`;
  document.querySelectorAll('[data-job]').forEach(b => b.onclick = () => detail(b.dataset.job));
  if ($('#first-job')) $('#first-job').onclick = openCreate;
}
async function detail(id) {
  if (!await guard.canLeave()) { cancelNavigation(); return; }
  const request = ++viewRequest;
  nav(); $('#content').innerHTML = '<div class="loading">正在读取制作需求…</div>';
  try {
    const job = await api(`/api/jobs/${id}`); if (request !== viewRequest) return; current = job; commitView('#job/'+id); $('#nav-count').hidden=true;
    $('#breadcrumb').textContent = '制作任务 / 任务详情'; const b = job.brief;
    $('#content').innerHTML = `<button class="text-button back" id="back">← 返回任务列表</button><div class="page-heading"><div><p class="eyebrow">PRODUCTION BRIEF</p><h1 class="detail-title">${esc(job.title)}</h1><span class="badge ${job.technicalSample?'sample':''}">${job.technicalSample?'技术样例 · 不代表视频成片':'需求准备中'}</span></div><div class="actions"><button id="duplicate">复制为变体</button><button id="export">导出需求</button></div></div>
    <div class="detail-grid"><div><form id="edit-form" class="panel"><h2>制作需求</h2><p class="muted">将确认过的事实与创作要求留在这里。</p><label>任务名称<input name="title" required maxlength="120" value="${esc(b.title)}"></label><div class="form-grid"><label>账号 / 项目<input name="account" required value="${esc(b.account)}"></label><label>目标语言<input name="language" required value="${esc(b.language)}"></label></div><label>商品事实与卖点<textarea name="product" rows="4" required>${esc(b.product)}</textarea></label><label>制作要求<textarea name="requirements" rows="5" required>${esc(b.requirements)}</textarea></label><label>参考素材（每行一个链接或本地路径）<textarea name="references" rows="3" placeholder="可以留空，稍后补充">${esc(b.references.join('\n'))}</textarea></label><p class="muted">此处只记录引用，不会自动上传或下载文件。</p><div class="dialog-actions save-bar"><span id="save-status" role="status">所有修改已保存</span><button type="submit" class="primary">保存需求</button></div><p id="save-error" class="error" role="alert"></p></form>
    <div class="panel"><h2>工程检查记录</h2><p class="muted">检查结果与成片验收分开记录。</p>${job.inspections.length ? job.inspections.slice().reverse().map(r=>`<div class="history-row"><span class="badge ${r.ok?'good':'bad'}">${r.ok?'通过':'未通过'}</span> ${esc(r.operation)} · ${esc(r.source)}<small>${date(r.finishedAt)}</small>${!r.ok?`<p class="error">${esc(r.data?.error?.message || r.error || '检查失败')}</p>`:''}</div>`).join('') : '<p class="muted">暂无记录。完成工程准备后可执行检查。</p>'}
    <details><summary>本地工程工具</summary><p class="muted">仅检查可信本地工程，不会提交视频制作。</p><form id="inspect-form"><label>工程相对路径<input name="source" value="build.svrun" required></label><label>操作<select name="operation"><option value="check">检查工程</option><option value="plan">查看执行计划</option></select></label><p><button type="submit">运行检查</button></p><p id="inspect-error" class="error" role="alert"></p></form></details></div></div>
    <div class="detail-side"><div class="panel"><p class="eyebrow">NEXT STEPS</p><h2>制作准备</h2><ul class="checklist"><li>制作需求<span>已保存</span></li><li>参考素材<span>${b.references.length?'已记录引用':'待补充'}</span></li><li>模型与视频服务<span>未配置</span></li><li>制作预算<span>待确定</span></li></ul><p class="muted">服务接通后，再进入分析、生成和成片审核。</p><button disabled title="模型与视频服务尚未配置">开始制作 · 待接通服务</button></div><div class="panel"><p class="eyebrow">WORKSPACE</p><h3>独立保存，随时继续</h3><p class="muted">任务资料保存在本机配置的数据目录。刷新页面或重启服务后仍可读取。</p><p class="muted">创建于 ${date(job.createdAt)}</p></div></div></div>`;
    const agentPanel=document.createElement('div');agentPanel.className='panel';document.querySelector('.detail-side').prepend(agentPanel);mountAgent(agentPanel,id,()=>guard.hasChanges());
    $('#back').onclick = list;
    const editForm=$('#edit-form'); const initialValues=JSON.stringify([...new FormData(editForm)]);
    editForm.oninput = () => guard.setDirty(JSON.stringify([...new FormData(editForm)])!==initialValues);
    $('#edit-form').onsubmit = async e => { e.preventDefault(); const button = e.submitter; button.disabled = true; button.textContent = '保存中…'; e.target.inert=true; guard.setPending(true); $('#save-error').textContent = ''; try { const f = Object.fromEntries(new FormData(e.target)); current = await api(`/api/jobs/${id}/brief`, 'PUT', { revision: job.revision, brief: { ...b, ...f, references:f.references.split('\n').map(x=>x.trim()).filter(Boolean) } }); guard.setDirty(false); guard.setPending(false); await detail(id); toast('制作需求已保存'); } catch(err) { $('#save-error').textContent = err.message; button.disabled = false; button.textContent = '保存需求'; e.target.inert=false; guard.setPending(false); } };
    $('#duplicate').onclick = async e => { if(guard.hasChanges()){toast('请先保存修改，再复制变体');return;} if (!await guard.canLeave()) return; guard.setPending(true); e.target.disabled = true; try { const copy = await api(`/api/jobs/${id}/duplicate`, 'POST', {}); guard.setPending(false); $('#nav-count').textContent=Number($('#nav-count').textContent)+1; await detail(copy.id); toast('已创建独立变体，可调整账号和需求'); } catch(err) { guard.setPending(false); toast(err.message); e.target.disabled = false; } };
    $('#export').onclick = () => { if (guard.hasChanges()) { toast('请先保存修改，再导出需求'); return; } const url = URL.createObjectURL(new Blob([JSON.stringify(current.brief, null, 2)], {type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = `${id}-brief.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); };
    $('#inspect-form').onsubmit = async e => { e.preventDefault(); if(guard.hasChanges()){toast('请先保存修改，再运行检查');return;} if (!await guard.canLeave()) return; guard.setPending(true); const button=e.submitter; button.disabled=true; button.textContent='检查中…'; try { const record=await api(`/api/jobs/${id}/inspect`,'POST',Object.fromEntries(new FormData(e.target))); guard.setPending(false); await detail(id); toast(record.ok?'检查通过，结果已保存':'检查未通过，诊断已保存'); } catch(err) { guard.setPending(false); $('#inspect-error').textContent=err.message; button.disabled=false; button.textContent='运行检查'; } };
  } catch(e) { if (request !== viewRequest) return; toast(e.message); await list(); }
}
async function services() {
  if (!await guard.canLeave()) { cancelNavigation(); return; }
  const request = ++viewRequest;
  commitView('#services'); current=null; nav(true);
  try {
    $('#content').innerHTML='<div class="loading">正在读取服务状态…</div>';
    const state=await api('/api/services'); if (request !== viewRequest) return;
    $('#content').innerHTML=`<div class="page-heading"><div><p class="eyebrow">CONNECTIONS</p><h1>制作服务</h1><p class="muted">源码已纳入项目；下方区分工作台已接通能力与仍待配置的制作服务。</p></div></div><div class="notice"><div><h3>当前处于准备阶段</h3><p>${esc(state.message)}</p><p>${state.agent.sourceIntegration?'当前运行：本仓库 Pi 构建产物 + Hypit 源码。':'当前运行：自定义引擎路径。'}</p></div></div>${[['01','任务工作台','创建、编辑、复制需求；资料保存在本机。','可使用',true],['02','Pi 制作 Agent','已接入真实会话、任务工具、执行记录与停止控制；模型需单独配置。',state.agent.modelConfigured?'模型已配置':'引擎已接入',state.agent.piInstalled],['03','图像 / 视频 / 语音','接入服务并确定预算后，再启用生成。','待配置',false],['04','Hypit 工程工具','已提供本地检查入口；具体可用性以每次检查结果为准。','本地接入',true]].map(([n,title,description,status,on])=>`<div class="panel service-card"><span class="service-symbol">${n}</span><div class="service-text"><h2>${title}</h2><p class="muted">${description}</p></div><span class="badge ${on?'good':''}">${status}</span></div>`).join('')}<p class="muted">拿到 API 后再接入，无需现在填写密钥。当前页面不会产生生成费用。</p>`;
  } catch(e) { if (request !== viewRequest) return; $('#content').innerHTML='<div class="panel empty"><h2>服务状态读取失败</h2><p class="error">'+esc(e.message)+'</p><button id="retry-services">重试</button></div>'; $('#retry-services').onclick=services; }
}
$('#tasks-nav').onclick=list; $('#services-nav').onclick=services; $('#close-dialog').onclick=async()=>{ if(await guard.canLeave()) { $('#create-form').reset(); $('#create-dialog').close(); } };
$('#create-form').oninput=()=>guard.setDirty(true);
$('#create-dialog').addEventListener('cancel',async e=>{e.preventDefault();if(await guard.canLeave()) $('#create-dialog').close();});
$('.brand').onclick=async e=>{e.preventDefault();await list();};
$('#create-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;guard.setPending(true);e.target.inert=true;$('#form-error').textContent='';try{const f=Object.fromEntries(new FormData(e.target));const job=await api('/api/jobs','POST',{...f,account:f.account.trim()||'待确定',product:f.product.trim()||'待补充',requirements:f.requirements.trim()||'待补充',technicalSample:false,references:[]});guard.setDirty(false);guard.setPending(false);$('#create-dialog').close();$('#nav-count').textContent=Number($('#nav-count').textContent)+1;e.target.reset();await detail(job.id);toast('任务已创建');}catch(err){$('#form-error').textContent=err.message;}finally{button.disabled=false;e.target.inert=false;guard.setPending(false);}};
async function restoreView(){const route=parseView(location.hash); if(route.type==='job') await detail(route.id); else if(route.type==='services') await services(); else await list();}
window.addEventListener('hashchange', restoreView);
restoreView();
