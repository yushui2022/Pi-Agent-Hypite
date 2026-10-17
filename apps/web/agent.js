import { api } from './api.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountAgent(host, id, hasChanges) {
  host.innerHTML = `<h2>Pi × Hypit 工程助手</h2><p class="muted" data-status>正在读取引擎状态…</p><label>工程准备指令<textarea data-prompt rows="3" placeholder="例如：根据已保存需求编写分镜方案，标出待补充素材。"></textarea></label><div class="actions"><button data-probe>检查引擎接入</button><button data-author disabled>准备工程</button><button data-stop disabled>停止会话</button></div><p class="error" data-error role="alert"></p><div data-runs aria-live="polite"></div>`;
  const find = key => host.querySelector(`[data-${key}]`);
  let busy = false, configured = false, installed = false, timer;
  const labels = {starting:'启动中',running:'执行中',stopping:'停止中',completed:'会话结束',failed:'失败',cancelled:'已停止',interrupted:'服务中断'};
  async function refresh() {
    if (!host.isConnected) return;
    try {
      const [state, runs] = await Promise.all([api('/api/services'), api(`/api/jobs/${id}/agent-runs`)]);
      if (!host.isConnected) return;
      configured = state.agent.modelConfigured;
      installed = state.agent.piInstalled && state.agent.hypitInstalled && state.agent.skillInstalled;
      busy = runs.some(r => ['starting','running','stopping'].includes(r.status));
      find('status').textContent = !installed ? '引擎依赖缺失，请运行 npm ci。' : configured ? `模型：${state.agent.provider} / ${state.agent.model}。准备工程会调用模型；不提交视频生成。` : 'Pi 与 Hypit 已安装。可免费检查接入；配置模型后可准备工程，视频生成尚未接通。';
      find('probe').disabled = busy || !installed;
      find('author').disabled = busy || !configured || !installed;
      find('stop').disabled = !busy;
      find('runs').innerHTML = runs.slice(0,10).map(r => `<details ${r===runs[0]?'open':''}><summary>${escape(r.mode==='probe'?'接入检查':'工程准备')} · ${escape(r.mode==='probe'&&r.status==='completed'?'检查通过':labels[r.status]||r.status)} · ${escape(new Date(r.startedAt).toLocaleString())}</summary><p class="muted">会话 ${escape(r.sessionId || '待分配')}；会话结束不代表成片交付。</p>${r.error?`<p class="error">${escape(r.error)}</p>`:''}<pre class="agent-log">${escape(r.events.map(e=>`[${e.type}] ${e.text}`).join('\n'))}</pre></details>`).join('') || '<p class="muted">尚无会话记录。</p>';
    } catch(e) { if(host.isConnected) find('error').textContent=e.message; }
    clearTimeout(timer); if(host.isConnected) timer=setTimeout(refresh,2000);
  }
  async function start(mode) {
    if(hasChanges()){find('error').textContent='请先保存制作需求，再启动会话。';return;}
    find('probe').disabled=true;find('author').disabled=true;find('error').textContent='';
    try {await api(`/api/jobs/${id}/agent-runs`,'POST',{mode,prompt:find('prompt').value,requestId:crypto.randomUUID()});}
    catch(e){find('error').textContent=e.message;}
    await refresh();
  }
  find('probe').onclick=()=>start('probe');find('author').onclick=()=>start('author');
  find('stop').onclick=async()=>{find('stop').disabled=true;try{await api(`/api/jobs/${id}/agent-stop`,'POST',{});}catch(e){find('error').textContent=e.message;}await refresh();};
  refresh();
}
