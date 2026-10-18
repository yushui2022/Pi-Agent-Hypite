// Presentation only: no network, persistence or authorization decisions.
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHTML;
export function button(label,{to,id,variant='secondary',disabled=false}={}){return `<button class="ds-button ds-${variant}" ${to?`data-go="${e(to)}"`:''} ${id?`id="${e(id)}"`:''} ${disabled?'disabled':''}>${e(label)}</button>`;}
export function pageHeader(title,description,action=''){return `<div class="ds-page-header"><div><h1>${e(title)}</h1><p>${e(description)}</p></div><div class="ds-actions">${action}</div></div>`;}
export function badge(label,tone='neutral'){return `<span class="ds-badge ds-tone-${e(tone)}">${e(label)}</span>`;}
export function emptyState(title,description,action=''){return `<section class="ds-empty"><h2>${e(title)}</h2><p>${e(description)}</p><div class="ds-actions">${action}</div></section>`;}
export function notice(message,tone='neutral'){return `<p class="ds-notice ds-tone-${e(tone)}">${e(message)}</p>`;}
export function loading(label='正在读取工作空间'){return `<div class="ds-loading" role="status"><span class="ds-spinner" aria-hidden="true"></span>${e(label)}</div>`;}
export function errorState(message){return `<section class="ds-empty" role="alert"><h2>暂时无法读取</h2><p>${e(message)}</p>${button('重试',{id:'page-retry',variant:'primary'})}</section>`;}
export function field(label,control){return `<label class="ds-field"><span>${e(label)}</span>${control}</label>`;}
export function select(id,options,value){return `<select id="${e(id)}">${options.map(([v,label])=>`<option value="${e(v)}" ${v===value?'selected':''}>${e(label)}</option>`).join('')}</select>`;}
export function toolbar(fields){return `<div class="ds-toolbar">${fields.join('')}${button('清除筛选',{id:'clear-filters',variant:'ghost'})}</div>`;}
export function pager(total,page,size=12){const max=Math.max(1,Math.ceil(total/size));return `<div class="ds-pager"><span role="status">${total} 条结果 · 第 ${page}/${max} 页</span><div class="ds-actions">${button('上一页',{id:'previous-page',disabled:page<=1})}${button('下一页',{id:'next-page',disabled:page>=max})}</div></div>`;}
export function gallery(){return pageHeader('界面组件','实际页面使用的标题、按钮、状态与反馈。仅展示外观和原生控件行为。')+`<section class="ds-gallery"><h2>操作层级</h2><div class="ds-actions">${button('主要操作',{variant:'primary'})}${button('次要操作')}${button('辅助操作',{variant:'ghost'})}${button('条件未满足',{disabled:true})}<button class="ds-button" disabled aria-busy="true">处理中…</button></div><h2>状态语义</h2><div class="ds-actions">${badge('待配置')}${badge('需要补充','warning')}${badge('资料已齐','success')}${badge('读取失败','danger')}</div><h2>字段与反馈</h2>${field('示例名称','<input placeholder="请输入名称" aria-describedby="demo-field-help">')}<p id="demo-field-help" class="ds-help">这是控件示例，不会提交数据。</p>${notice('已保存的计划不会自动进入执行队列。')}${loading('正在读取示例…')}${emptyState('暂无记录','真实页面会根据用户条件提供创建或清除筛选入口。')}</section>`;}
