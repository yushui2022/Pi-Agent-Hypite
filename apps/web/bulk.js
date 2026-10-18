import { api } from './api.js';
export { mountAccounts } from './accounts.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={planned:'待确认建档',preparing:'正在建档',paused:'已暂停',failed:'建档失败',ready:'任务已建齐'};
const heading=(eyebrow,title,description)=>`<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="muted">${description}</p></div></div>`;
const errorBox='<p class="error" id="bulk-error" role="alert"></p>';
const pageSize=40;
function pager(container,total,page,onChange){
  container.innerHTML=`<button data-prev ${page===0?'disabled':''}>上一页</button><span>第 ${page+1} / ${Math.max(1,Math.ceil(total/pageSize))} 页 · ${total} 条</span><button data-next ${(page+1)*pageSize>=total?'disabled':''}>下一页</button>`;
  container.querySelector('[data-prev]').onclick=()=>onChange(page-1);container.querySelector('[data-next]').onclick=()=>onChange(page+1);
}

export async function mountBatches(ctx) {
  const {root,navigate,isCurrent}=ctx;
  const batches=await api('/api/batches');if(!isCurrent())return;
  root.innerHTML=heading('BATCH DESK','批次工作台','将多个账号的内容需求组织成一批。当前支持任务建档，视频生产服务尚未接入。')+`<div class="toolbar"><span>${batches.length} 个批次</span><button class="primary" id="new-batch">新建批次</button></div><div id="batches-list"></div><div class="bulk-pager" id="batches-pager"></div>`;
  let page=0;function render(){root.querySelector('#batches-list').innerHTML=batches.slice(page*pageSize,(page+1)*pageSize).map(b=>`<article class="bulk-row"><div><button class="job-title" data-batch="${b.id}">${esc(b.title)}</button><p class="muted">${b.accountCount} 个账号 · ${b.total} 条任务 · 已建档 ${b.prepared}</p></div><span class="badge">${labels[b.state]||esc(b.state)}</span></article>`).join('')||'<div class="panel empty">还没有批次。先录入账号，再创建一批制作需求。</div>';pager(root.querySelector('#batches-pager'),batches.length,page,value=>{page=value;render();});root.querySelectorAll('[data-batch]').forEach(b=>b.onclick=()=>navigate('#batch/'+b.dataset.batch));}
  root.querySelector('#new-batch').onclick=()=>navigate('#batch-new');render();
}

export async function mountBatchNew(ctx) {
  const {root,guard,navigate,isCurrent}=ctx;const accounts=(await api('/api/accounts')).filter(a=>a.active);if(!isCurrent())return;
  if(!accounts.length){root.innerHTML=heading('BATCH PLAN','新建批次','先添加至少一个启用的账号。')+'<button id="go-accounts" class="primary">管理账号资料</button>';root.querySelector('#go-accounts').onclick=()=>navigate('#accounts');return;}
  root.innerHTML=heading('BATCH PLAN','新建批次','先审阅账号配置快照与任务数量，确认后才建立独立任务。')+`<form id="batch-form"><div class="bulk-layout"><section class="panel"><label>批次名称<input name="title" required maxlength="120" placeholder="例如：咖啡杯 · 本周内容"></label><label>商品事实与卖点<textarea name="product" required maxlength="4000" rows="4"></textarea></label><label>本批制作要求<textarea name="requirements" required maxlength="4000" rows="4"></textarea></label><label>每个账号的任务数量<input name="perAccount" type="number" min="1" max="20" value="3" required></label><p class="muted">账号语言、受众、风格和输出规格会附入每条任务。内容差异需后续编写，不自动生成视频。</p></section><section class="panel"><h2>选择账号</h2><input id="batch-account-search" aria-label="筛选批次账号" placeholder="按编号、名称或分组筛选"><div class="actions"><button type="button" id="select-filtered">选中筛选结果</button><button type="button" id="clear-selected">清空选择</button></div><div id="batch-accounts" class="bulk-selection"></div><div class="bulk-pager" id="selection-pager"></div></section></div><div class="panel bulk-submit"><strong id="batch-count" role="status"></strong><button type="submit" class="primary">保存批次并预览</button>${errorBox}</div></form>`;
  const find=s=>root.querySelector(s),form=find('#batch-form'),selected=new Set();let query='',page=0,requestId=crypto.randomUUID();
  const filtered=()=>accounts.filter(a=>`${a.accountKey} ${a.name} ${a.group}`.toLowerCase().includes(query.toLowerCase()));
  function count(){find('#batch-count').textContent=`已选 ${selected.size} 个账号 × ${form.elements.perAccount.value||0} 条 = ${selected.size*Number(form.elements.perAccount.value||0)} 条任务（上限 2000）`;}
  function render(){const rows=filtered();find('#batch-accounts').innerHTML=rows.slice(page*pageSize,(page+1)*pageSize).map(a=>`<label class="bulk-choice"><input type="checkbox" value="${a.id}" ${selected.has(a.id)?'checked':''}><span>${esc(a.name)}<small>${esc(a.accountKey)} · ${esc(a.group||'未分组')} · ${esc(a.language)}</small></span></label>`).join('');pager(find('#selection-pager'),rows.length,page,value=>{page=value;render();});find('#batch-accounts').onchange=e=>{if(e.target.checked)selected.add(e.target.value);else selected.delete(e.target.value);changed();};count();}
  function changed(){guard.setDirty(true);requestId=crypto.randomUUID();count();}
  form.oninput=e=>{if(e.target.id!=='batch-account-search')changed();};
  find('#batch-account-search').oninput=e=>{query=e.target.value;page=0;render();};
  find('#select-filtered').onclick=()=>{filtered().forEach(a=>selected.add(a.id));changed();render();};find('#clear-selected').onclick=()=>{selected.clear();changed();render();};
  form.onsubmit=async event=>{event.preventDefault();find('#bulk-error').textContent='';guard.setPending(true);form.inert=true;try{const values=Object.fromEntries(new FormData(form));const batch=await api('/api/batches','POST',{title:values.title,product:values.product,requirements:values.requirements,perAccount:Number(values.perAccount),accountIds:[...selected],requestId});guard.setDirty(false);guard.setPending(false);await navigate('#batch/'+batch.id);}catch(e){guard.setPending(false);if(!isCurrent())return;find('#bulk-error').textContent=e.message;form.inert=false;}};render();
}

export async function mountBatch(ctx,id) {
  const {root,navigate,isCurrent}=ctx;let page=0,batch,busy=false;
  root.innerHTML=heading('BATCH OVERVIEW','批次详情','建档进度与视频生产进度分开记录。')+`<div id="batch-status" class="panel"></div><p id="batch-action-error" class="error" role="alert"></p><div class="panel"><h2>任务清单</h2><div class="bulk-pager" id="batch-tasks-pager"></div><div id="batch-tasks"></div></div>`;
  function renderTasks(){root.querySelector('#batch-tasks').innerHTML=batch.tasks.slice(page*pageSize,(page+1)*pageSize).map((task,index)=>{const account=batch.accounts.find(a=>a.id===task.accountId),ready=page*pageSize+index<batch.prepared;return `<article class="bulk-row"><div>${ready?`<button class="job-title" data-job-id="${task.id}">${esc(account.name)} · 第 ${task.sequence} 条</button>`:`<strong>${esc(account.name)} · 第 ${task.sequence} 条</strong>`}<p class="muted">${esc(account.accountKey)} · ${esc(account.language)} · ${esc(account.style||'未指定风格')} · ${esc(account.spec||'未指定规格')}</p></div><span class="badge">${ready?'需求待制作':'尚未建档'}</span></article>`;}).join('');pager(root.querySelector('#batch-tasks-pager'),batch.tasks.length,page,value=>{page=value;renderTasks();});root.querySelectorAll('[data-job-id]').forEach(b=>b.onclick=()=>navigate('#job/'+b.dataset.jobId));}
  async function refresh(){
    if(!isCurrent())return;
    try {
      batch=await api('/api/batches/'+id);if(!isCurrent())return;
      root.querySelector('#batch-status').innerHTML=`<div class="page-heading"><div><h2>${esc(batch.title)}</h2><p class="muted">${batch.accounts.length} 个账号 · ${batch.tasks.length} 条任务 · ${labels[batch.state]}</p></div><button id="batch-back">返回批次列表</button></div><progress max="${batch.tasks.length}" value="${batch.prepared}" aria-label="任务建档进度"></progress><p>已建档 ${batch.prepared} / ${batch.tasks.length} · 视频生成尚未启用</p><details><summary>查看已固定的制作要求</summary><p>${esc(batch.product)}</p><p class="bulk-text">${esc(batch.requirements)}</p></details>${batch.error?`<p class="error">${esc(batch.error)}</p>`:''}<div class="actions">${batch.state==='preparing'?`<button id="batch-pause" ${busy||batch.pauseRequested?'disabled':''}>${batch.pauseRequested?'正在暂停…':'暂停建档'}</button>`:batch.state==='ready'?'<span class="badge good">任务已建齐，可逐条准备工程</span>':`<button id="batch-start" class="primary" ${busy?'disabled':''}>${batch.state==='planned'?'确认并建立任务':'继续建档'}</button>`}</div>`;
      root.querySelector('#batch-back').onclick=()=>navigate('#batches');renderTasks();
      for(const action of ['start','pause']){const button=root.querySelector('#batch-'+action);if(button)button.onclick=async()=>{busy=true;button.disabled=true;root.querySelector('#batch-action-error').textContent='';try{await api('/api/batches/'+id+'/'+action,'POST',{});}catch(e){if(isCurrent())root.querySelector('#batch-action-error').textContent=e.message;}finally{busy=false;if(isCurrent())await refresh();}};}
    }catch(e){if(isCurrent())root.querySelector('#batch-action-error').textContent=e.message;}
  }
  await refresh();
  async function poll(){if(!isCurrent())return;if(!busy&&batch?.state==='preparing')await refresh();if(isCurrent())setTimeout(poll,1500);}
  if(isCurrent())setTimeout(poll,1500);
}
