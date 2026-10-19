import {mountHome,scenarioCards} from './home.js';
import {icon,hydrateIcons} from './icons.js';
import {mountWorkspace,projectContext} from './workspace.js';
import {errorState,gallery} from './components.js';
import {uploadReference} from './reference-upload.js';
import {api} from './api.js';
import {initTheme,createEditGuard} from './ui.js';
import {mountRemix} from './remix.js';
try{if(!localStorage.getItem('workspace-theme'))localStorage.setItem('workspace-theme','dark');}catch{}
initTheme();hydrateIcons();const guard=createEditGuard(),$=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Navigation preferences are presentation-only and contain no workspace data.
$('#mobile-nav-links').append($('#studio-sidebar nav').cloneNode(true));
function setSidebar(compact){document.body.dataset.sidebar=compact?'compact':'expanded';$('#sidebar-toggle').setAttribute('aria-expanded',String(!compact));$('#sidebar-toggle').setAttribute('aria-label',compact?'展开导航':'收起导航');$('#sidebar-toggle').title=compact?'展开导航':'收起导航';}
try{setSidebar(localStorage.getItem('studio-sidebar')==='compact');}catch{setSidebar(false);}
$('#sidebar-toggle').onclick=()=>{const compact=document.body.dataset.sidebar!=='compact';setSidebar(compact);try{localStorage.setItem('studio-sidebar',compact?'compact':'expanded');}catch{}};
$('#mobile-menu').onclick=()=>{$('#mobile-nav').showModal();$('#mobile-menu').setAttribute('aria-expanded','true');};
$('#mobile-nav-close').onclick=()=>$('#mobile-nav').close();
$('#mobile-nav').addEventListener('close',()=>$('#mobile-menu').setAttribute('aria-expanded','false'));
const narrowNavigation=matchMedia('(max-width:760px)');narrowNavigation.addEventListener('change',()=>{if(!narrowNavigation.matches)$('#mobile-nav').close();});
$('#nav-theme').value=$('#theme').value;
$('#nav-theme').onchange=e=>{$('#theme').value=e.target.value;$('#theme').dispatchEvent(new Event('change'));};
$('#theme').addEventListener('change',()=>$('#nav-theme').value=$('#theme').value);
let root=$('#content'),user=null,registration=false,version=0,lastRoute=location.hash||'#home',draft='',afterLogin=null,timer,creationId=crypto.randomUUID(),creating=false,referenceFile=null;
let workspaceStates={}, disposeHome=null;
const channel=new BroadcastChannel('pi-studio-auth');
const templates=[{name:'商品广告',tag:'PRODUCT STORY',art:'product',prompt:'保留参考视频的节奏，替换为我的商品素材，制作三组不同卖点的版本。',desc:'一份参考，多个产品表达'},{name:'旅行故事',tag:'A DIFFERENT VIEW',art:'travel',prompt:'保留参考的叙事节奏，使用我的旅行片段重新编排，分别制作城市与自然两个版本。',desc:'用自己的镜头，重新讲述'},{name:'品牌短片',tag:'MAKE IT YOURS',art:'brand',prompt:'沿用参考片的镜头结构，替换品牌图片与结尾文案，安排多个主题批次。',desc:'为每个主题保留独立版本'}];
function toast(message){clearTimeout(timer);$('#message').textContent=message;$('#message').hidden=false;timer=setTimeout(()=>$('#message').hidden=true,5000);}
function resetRoot(){disposeHome?.();disposeHome=null;const clean=root.cloneNode(false);root.replaceWith(clean);root=clean;}
function account(){ $('#account-name').textContent=user?.name||'登录你的空间';$('#header-login').hidden=!!user;$('#logout').hidden=!user;$('#mobile-account').hidden=!user;$('#workspace-name').hidden=!user;$('#workspace-name').textContent=user?.workspace_name||'';$('#account-email').textContent=user?.email||'';}
function clear(){version++;user=null;workspaceStates={};afterLogin=null;draft='';referenceFile=null;resetRoot();guard.setDirty(false);guard.setPending(false);$('#account-dialog').close();account();render();}
function openAuth(action){afterLogin=action||null;$('#auth-error').textContent='';$('#auth-view').showModal();}
function templateCards(){return scenarioCards(templates);}
function bindTemplates(){root.querySelectorAll('[data-template]').forEach(b=>b.onclick=async()=>{if(!await guard.canLeave())return;draft=templates[Number(b.dataset.template)].prompt;creationId=crypto.randomUUID();history.pushState(null,'','#home');await render();guard.setDirty(true);$('#creation-prompt')?.focus();});}
async function createProject(){
 if(creating)return;if(!referenceFile){$('#upload-feedback').innerHTML='<p class="error">请选择一条参考视频后再开始，支持 MP4、WebM、MOV。</p>';toast('请先选择一条参考视频');$('#reference-file')?.focus();return;}
 const prompt=$('#creation-prompt')?.value.trim()||draft;draft=prompt;if(!user){openAuth(createProject);return;}
 creating=true;guard.setPending(true);$('#upload-feedback').innerHTML='<p>正在建立项目并传输参考视频，请保持页面打开。</p><progress id="reference-progress" max="100" value="0" aria-label="参考视频上传进度"></progress>';$('#create-project').textContent='正在导入…';$('#create-project').setAttribute('aria-busy','true');const form=$('#creation-form');if(form)form.inert=true;let project;
 try{project=await api('/api/remix','POST',{title:referenceFile.name.replace(/\.[^.]+$/,'').slice(0,100)+' · 复刻',...(prompt?{brief:prompt}:{}),requestId:creationId});
 await uploadReference(project.id,referenceFile,(done,total)=>{if($('#reference-progress'))$('#reference-progress').value=Math.round(done/total*100);if($('#reference-status'))$('#reference-status').textContent='正在上传参考视频 · '+Math.round(done/total*100)+'%';});
 draft='';referenceFile=null;creationId=crypto.randomUUID();guard.setDirty(false);guard.setPending(false);await navigate('#remix/'+project.id);toast('参考视频已导入并设为当前参考，请添加替换素材。');
 }catch(e){if(project){draft='';referenceFile=null;creationId=crypto.randomUUID();guard.setDirty(false);guard.setPending(false);await navigate('#remix/'+project.id);toast('项目已保留，参考导入未完成：'+e.message+'。请在项目中重新导入。');}else{if($('#upload-feedback'))$('#upload-feedback').textContent=e.message;toast(e.message);}
 }finally{creating=false;guard.setPending(false);if(form)form.inert=false;if($('#create-project')){$('#create-project').innerHTML='创建复刻项目 '+icon('arrow');$('#create-project').removeAttribute('aria-busy');}}
}
function home(){const ticket=version;disposeHome=mountHome({root,draft,file:referenceFile,signedIn:!!user,templates,isCurrent:()=>ticket===version,onFile:file=>{referenceFile=file;creationId=crypto.randomUUID();guard.setDirty(!!draft||!!file);},onDraft:value=>{draft=value;creationId=crypto.randomUUID();guard.setDirty(!!draft||!!referenceFile);},onSubmit:createProject});bindTemplates();}
function coming(mode){const image=mode==='image';root.innerHTML=`<section class="capability-page"><h1>${image?'图片生成暂未开放':'智能体创作暂未开放'}</h1><p>${image?'可先将已有图片加入复刻项目。':'可先配置替换方案，再安排制作批次。'}</p><div class="capability-actions"><button class="primary" data-go="#remix">${image?'整理项目素材':'创建改编计划'}</button><button data-go="#home">返回探索</button></div></section>`;}
async function render(){const ticket=++version;resetRoot();lastRoute=location.hash||'#home';const route=lastRoute.slice(1).split('/')[0];document.body.dataset.page=route;document.querySelectorAll('[data-route]').forEach(a=>a.setAttribute('aria-current',a.dataset.route===route?'page':'false'));$('#page-label').textContent=({home:'开始复刻',remix:'复刻项目',assets:'替换素材库',works:'成品库',tasks:'制作任务',components:'组件与状态',templates:'复刻场景',image:'AI 图片',agent:'创作智能体'})[route]||'页面不存在';try{if(route==='home')home();else if(route==='components')root.innerHTML=gallery();else if(route==='templates'){root.innerHTML='<div class="section-heading"><div><h1>复刻场景</h1><p>选择场景，快速填写创作要求。</p></div></div>'+templateCards();bindTemplates();}else if(['image','agent'].includes(route))coming(route);else if(['remix','assets','works','tasks'].includes(route)){if(!user){root.innerHTML='<section class="library-empty"><span>'+icon('folder')+'</span><h1>登录创作空间</h1><p>登录后查看项目、素材与作品。</p><button id="space-login" class="primary">登录 / 创建空间</button></section>';$('#space-login').onclick=()=>openAuth();}else if(route==='remix'&&lastRoute!=='#remix'){const match=lastRoute.match(/^#remix\/(remix_[a-f0-9-]{36})(?:\/(assets|plan|batches|outputs))?$/);const id=match?.[1];await mountRemix({root,guard,navigate,isCurrent:()=>ticket===version&&!!user,toast,saas:true,projectContext,icon},{id,tab:match?.[2]});}else{const kind=route==='remix'?'projects':route;await mountWorkspace({root,kind,state:workspaceStates[kind]??={},isCurrent:()=>ticket===version&&!!user});}}else{root.innerHTML='<section class="library-empty"><h1>暂时找不到这个页面</h1><button data-go="#home">返回首页</button></section>';}}catch(e){if(ticket===version){root.innerHTML=errorState(e.message);$('#page-retry').onclick=()=>render();}}}
async function navigate(hash){const dirty=guard.hasChanges();if(!await guard.canLeave())return;if(dirty){draft='';referenceFile=null;}$('#mobile-nav').close();history.pushState(null,'',hash);await render();window.scrollTo(0,0);root.focus({preventScroll:true});}
document.addEventListener('click',e=>{const link=e.target.closest('[data-go],a[href^="#"]');if(!link||link.classList.contains('skip-link'))return;e.preventDefault();navigate(link.dataset.go||link.getAttribute('href'));});
window.addEventListener('hashchange',async()=>{const dirty=guard.hasChanges();if(!await guard.canLeave()){history.replaceState(null,'',lastRoute);return;}if(dirty){draft='';referenceFile=null;}render();});
$('#header-login').onclick=()=>openAuth();$('#account-button').onclick=()=>user?$('#account-dialog').showModal():openAuth();$('#mobile-account').onclick=()=>$('#account-dialog').showModal();$('#account-close').onclick=()=>$('#account-dialog').close();$('#account-theme').value=$('#theme').value;$('#account-theme').onchange=e=>{$('#theme').value=e.target.value;$('#theme').dispatchEvent(new Event('change'));};$('#theme').addEventListener('change',()=>$('#account-theme').value=$('#theme').value);$('#auth-close').onclick=()=>{$('#auth-view').close();afterLogin=null;};
$('#auth-toggle').onclick=()=>{registration=!registration;$('#name-label').hidden=!registration;$('#auth-form').elements.name.required=registration;$('#auth-title').textContent=registration?'创建你的创作空间':'登录创作空间';$('#auth-submit').textContent=registration?'创建账号并进入':'登录';$('#auth-toggle').textContent=registration?'已有账号？返回登录':'还没有账号？创建空间';$('#auth-form').elements.password.autocomplete=registration?'new-password':'current-password';$('#auth-error').textContent='';};
$('#auth-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;form.inert=true;$('#auth-error').textContent='';try{const result=await api('/api/auth/'+(registration?'register':'login'),'POST',Object.fromEntries(new FormData(form)));user=result.user;channel.postMessage('changed');account();form.reset();$('#auth-view').close();const action=afterLogin;afterLogin=null;if(action)await action();else await render();}catch(e){$('#auth-error').textContent=e.message;}finally{form.inert=false;}};
async function logout(){if(!await guard.canLeave())return;try{await api('/api/auth/logout','POST',{});clear();channel.postMessage('changed');}catch(e){toast(e.message);}}
$('#logout').onclick=logout;$('#account-logout').onclick=()=>{$('#account-dialog').close();logout();};
window.addEventListener('saas-session-expired',clear);channel.onmessage=()=>{clear();toast('登录状态已在其他页面更改。');};
window.addEventListener('focus',async()=>{if(!user)return;try{const r=await api('/api/auth/me');if(r.user.id!==user?.id)clear();}catch{clear();}});
try{user=(await api('/api/auth/me')).user;}catch{}account();await render();
