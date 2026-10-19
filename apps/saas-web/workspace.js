import {api} from './api.js';
import {escapeHTML as e,button,pageHeader,badge,emptyState,notice,loading,field,select,toolbar,pager} from './components.js';
import {projectStage,batchIssues,assetRole,filterItems,pageItems} from './workspace-model.js';
import {icon} from './icons.js';

const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MiB':Math.ceil(n/1024)+' KiB';
const date=value=>new Date(value).toLocaleDateString('zh-CN');
export async function readWorkspace(){
  const list=await api('/api/remix'),details=new Array(list.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(5,list.length)},async()=>{
    while(cursor<list.length){const i=cursor++;details[i]=await api('/api/remix/'+list[i].id);}
  }));
  return details;
}
export function projectContext(p){
  const s=projectStage(p);
  return '<div class="ds-project-context"><div>'+badge(s.label,s.tone)+'<span>'+e(s.hint)+'</span></div>'+button(s.action,{to:'#remix/'+p.id+'/'+s.tab,variant:'primary'})+'</div>';
}
function cover(p){
  const a=p.assets.find(a=>a.id===p.plan.referenceId&&a.available&&a.mime.startsWith('video/'));
  return '<a class="project-cover" href="#remix/'+p.id+'" aria-label="打开项目：'+e(p.title)+'">'+
    '<span class="project-cover-fallback">'+icon('video')+'<span>'+(a?'参考视频':'尚未添加参考')+'</span></span>'+
    (a?'<video muted playsinline preload="metadata" src="'+e(a.url)+'#t=0.1" aria-hidden="true" tabindex="-1"></video>':'')+
    '<span class="project-cover-action">'+icon('arrow')+'</span></a>';
}
function projectCard(p,view){
  const s=projectStage(p);
  if(view==='list')return '<article class="ds-project-row"><div class="ds-project-name"><a href="#remix/'+p.id+'">'+e(p.title)+'</a><p>'+p.assets.length+' 份素材 · '+p.plan.rows.length+' 个替换位置 · '+p.batches.length+' 个批次</p><small>创建于 '+date(p.createdAt)+'</small></div><div>'+badge(s.label,s.tone)+'<p>'+e(s.hint)+'</p></div>'+button(s.action,{to:'#remix/'+p.id+'/'+s.tab})+'</article>';
  return '<article class="project-card">'+cover(p)+'<div class="project-card-body"><div class="project-card-meta">'+badge(s.label,s.tone)+'<span>'+date(p.createdAt)+'</span></div><h2><a href="#remix/'+p.id+'">'+e(p.title)+'</a></h2><p>'+p.assets.length+' 份素材 <span>·</span> '+p.plan.rows.length+' 个替换位置 <span>·</span> '+p.batches.length+' 个批次</p><div class="project-card-next"><span>'+e(s.hint)+'</span><a href="#remix/'+p.id+'/'+s.tab+'">'+e(s.action)+icon('arrow')+'</a></div></div></article>';
}
export async function mountWorkspace({root,kind,state,isCurrent}){
  root.innerHTML=loading();
  const projects=await readWorkspace();if(!isCurrent())return;
  const $=selector=>root.querySelector(selector);
  const defaults={q:'',project:'',status:'',type:'',role:'',sort:'newest',page:1,view:'grid'};
  for(const [key,value] of Object.entries(defaults))if(state[key]===undefined)state[key]=value;
  if(state.project&&!projects.some(p=>p.id===state.project))state.project='';
  const title={projects:'复刻项目',assets:'替换素材库',tasks:'制作任务',works:'成品库'}[kind];
  const descriptions={projects:'从参考到替换方案，让每一批创作都有迹可循。',assets:'集中查看参考与替换素材，回到项目继续创作。',tasks:'检查批次与版本，补齐制作所需的内容。',works:'查看项目成品。'};
  const projectOptions=[['','全部项目'],...projects.map(p=>[p.id,p.title])];
  const controls=[field('搜索','<span class="ds-search">'+icon('search')+'<input id="workspace-search" type="search" value="'+e(state.q)+'" placeholder="'+(kind==='projects'?'搜索项目名称':kind==='assets'?'搜索素材名称':'搜索批次或项目')+'"></span>')];
  if(kind!=='projects')controls.push(field('所属项目',select('filter-project',projectOptions,state.project)));
  if(kind==='projects')controls.push(field('准备阶段',select('filter-status',[['','全部阶段'],['reference','待导入参考'],['mapping','待配置替换'],['materials','待补素材或文案'],['batch','待安排批次'],['planned','已保存批次']],state.status)),field('排序',select('filter-sort',[['newest','创建时间：新到旧'],['oldest','创建时间：旧到新'],['title','项目名称']],state.sort)));
  if(kind==='assets')controls.push(field('媒体类型',select('filter-type',[['','全部类型'],['video','视频'],['image','图片'],['audio','音频']],state.type)),field('用途',select('filter-role',[['','全部用途'],['reference','当前参考'],['replacement','替换素材']],state.role)));
  if(kind==='tasks')controls.push(field('资料状态',select('filter-status',[['','全部批次'],['blocked','需要补充'],['ready','资料已填写']],state.status)));
  const batches=projects.flatMap(p=>p.batches.map(b=>({...b,project:p,issues:batchIssues(b,p)})));
  const assets=projects.flatMap(p=>p.assets.map(a=>({...a,project:p,role:assetRole(a,p)})));
  const overview=kind==='projects'?[[projects.length,'个项目'],[assets.length,'份素材'],[batches.length,'个批次']]:
    kind==='assets'?[[assets.length,'份素材'],[assets.filter(a=>a.role==='reference').length,'份当前参考'],[assets.filter(a=>a.role==='replacement').length,'份替换素材']]:
    [[batches.length,'个批次'],[batches.reduce((n,b)=>n+b.variants.length,0),'个版本'],[batches.filter(b=>b.issues.length).length,'个批次待补资料']];
  root.innerHTML=pageHeader(title,descriptions[kind],button(kind==='projects'?'新建复刻':'进入复刻项目',{to:kind==='projects'?'#home':'#remix',variant:'primary'}))+
    (kind==='works'?'':'<div class="workspace-overview" aria-label="当前空间概览">'+overview.map(([count,label])=>'<span><strong>'+count+'</strong>'+label+'</span>').join('')+'</div>')+
    (kind==='tasks'?notice('视频生成暂未开放，已保存的批次不会自动执行。'):'')+
    (kind==='works'?'':toolbar(controls)+'<div class="results-bar"><span id="results-summary" role="status"></span>'+
      (kind==='projects'?'<div class="view-switch" role="group" aria-label="项目显示方式"><button data-view="grid" aria-label="卡片视图" title="卡片视图">'+icon('grid')+'</button><button data-view="list" aria-label="列表视图" title="列表视图">'+icon('list')+'</button></div>':'')+'</div>')+
    '<div id="workspace-results"></div><div id="workspace-pagination"></div>';
  function draw(){
    let rows=[];
    if(kind==='projects')rows=filterItems(projects,state.q,p=>p.title).filter(p=>!state.status||projectStage(p).key===state.status).sort((a,b)=>state.sort==='title'?a.title.localeCompare(b.title,'zh-CN'):state.sort==='oldest'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));
    if(kind==='assets')rows=filterItems(assets,state.q,a=>a.name).filter(a=>(!state.project||a.project.id===state.project)&&(!state.type||a.mime.startsWith(state.type+'/'))&&(!state.role||a.role===state.role));
    if(kind==='tasks')rows=filterItems(batches,state.q,b=>b.title+' '+b.project.title).filter(b=>(!state.project||b.project.id===state.project)&&(!state.status||(state.status==='blocked'?b.issues.length:!b.issues.length)));
    const paged=pageItems(rows,state.page);state.page=paged.page;
    const allCount=kind==='projects'?projects.length:kind==='assets'?assets.length:batches.length;
    if(kind==='works'){$('#workspace-results').innerHTML=emptyState('还没有成品','视频生成暂未开放，可先保存替换方案与批次计划。',button('查看制作计划',{to:'#tasks'}),'video');return;}
    const filtered=!!(state.q||state.project||state.status||state.type||state.role);
    $('#results-summary').textContent=(filtered?'筛选结果':'全部'+(kind==='projects'?'项目':kind==='assets'?'素材':'批次'))+' · '+rows.length;
    $('#clear-filters').disabled=!filtered;
    root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===state.view)));
    if(!rows.length){
      $('#workspace-results').innerHTML=emptyState(allCount?'没有符合条件的结果':kind==='projects'?'从一条参考开始':kind==='assets'?'素材库还是空的':'还没有批次计划',
        allCount?'试试其他关键词，或清除筛选。':kind==='projects'?'导入参考视频，建立你的第一个复刻项目。':kind==='assets'?'在项目内导入参考和替换素材后，可在这里统一查找。':'先保存替换方案，再为不同素材组合安排版本。',
        allCount?button('清除全部筛选',{id:'reset-results'}):button(kind==='projects'?'导入参考视频':'进入复刻项目',{to:kind==='projects'?'#home':'#remix',variant:'primary'}),kind==='assets'?'media':kind==='tasks'?'tasks':'folder');
    }else if(kind==='projects'){
      $('#workspace-results').innerHTML='<div class="'+(state.view==='grid'?'project-grid':'ds-project-list')+'">'+paged.rows.map(p=>projectCard(p,state.view)).join('')+'</div>';
      root.querySelectorAll('.project-cover video').forEach(video=>{video.onerror=()=>{video.hidden=true;};});
    }else if(kind==='assets'){
      $('#workspace-results').innerHTML='<div class="ds-asset-grid">'+paged.rows.map(a=>'<article class="ds-asset-card"><div class="ds-asset-preview">'+(!a.available?badge('文件缺失','danger'):a.mime.startsWith('image/')?'<img loading="lazy" src="'+e(a.url)+'" alt="'+e(a.name)+'">':a.mime.startsWith('video/')?'<video controls playsinline preload="metadata" src="'+e(a.url)+'" aria-label="'+e(a.name)+'"></video>':'<audio controls preload="none" src="'+e(a.url)+'" aria-label="'+e(a.name)+'"></audio>')+'</div><div class="ds-asset-copy"><h2>'+e(a.name)+'</h2><div class="ds-actions">'+badge(a.role==='reference'?'当前参考':'替换素材')+'<span>'+size(a.size)+'</span></div><p>'+e(a.project.title)+'</p>'+button('查看所属项目',{to:'#remix/'+a.project.id+'/assets'})+'</div></article>').join('')+'</div>';
    }else{
      $('#workspace-results').innerHTML='<div class="ds-task-list">'+paged.rows.map(b=>'<article class="ds-task-row"><div><p>'+e(b.project.title)+'</p><h2>'+e(b.title)+'</h2><span>'+b.variants.length+' 个版本 · 保存于 '+date(b.createdAt)+'</span></div><div>'+badge(b.issues.length?'需要补充':'资料已填写',b.issues.length?'warning':'success')+'<p>尚未提交执行</p>'+(b.issues.length?'<details><summary>查看 '+b.issues.length+' 项缺项</summary><ul>'+b.issues.slice(0,50).map(x=>'<li>'+e(x)+'</li>').join('')+'</ul>'+(b.issues.length>50?'<p>其余缺项请进入批次查看。</p>':'')+'</details>':'')+'</div>'+button('查看批次',{to:'#remix/'+b.project.id+'/batches'})+'</article>').join('')+'</div>';
    }
    $('#workspace-pagination').innerHTML=pager(rows.length,state.page);
    $('#previous-page').onclick=()=>{state.page--;draw();$('#workspace-results').scrollIntoView({block:'start'});};
    $('#next-page').onclick=()=>{state.page++;draw();$('#workspace-results').scrollIntoView({block:'start'});};
    if($('#reset-results'))$('#reset-results').onclick=reset;
  }
  function reset(){
    const view=state.view;Object.assign(state,defaults,{view});$('#workspace-search').value='';
    for(const key of ['project','status','type','role','sort'])if($('#filter-'+key))$('#filter-'+key).value=state[key];
    draw();
  }
  $('#clear-filters')?.addEventListener('click',reset);
  $('#workspace-search')?.addEventListener('input',e=>{state.q=e.target.value;state.page=1;draw();});
  for(const key of ['project','status','type','role','sort'])$('#filter-'+key)?.addEventListener('change',e=>{state[key]=e.target.value;state.page=1;draw();});
  root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;draw();});
  draw();
}
