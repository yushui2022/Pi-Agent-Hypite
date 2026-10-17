// Shared presentation behavior. No business requests or job persistence here.
export function initTheme() {
  const select = document.querySelector('#theme');
  let preference = 'system';
  try { preference = localStorage.getItem('workspace-theme') || 'system'; } catch {}
  if (!['system','light','dark'].includes(preference)) preference = 'system';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => { document.documentElement.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference; };
  select.value = preference; apply();
  select.onchange = () => { preference = select.value; try { localStorage.setItem('workspace-theme', preference); } catch {} apply(); };
  media.addEventListener('change', apply);
}
export function createEditGuard() {
  let dirty = false, pending = false, resolveDecision;
  const dialog = document.querySelector('#leave-dialog');
  const decide = value => { dialog.close(); const resolve = resolveDecision; resolveDecision = null; resolve?.(value); };
  document.querySelector('#stay').onclick = () => decide(false);
  document.querySelector('#discard').onclick = () => { dirty = false; decide(true); };
  dialog.addEventListener('cancel', e => { e.preventDefault(); decide(false); });
  window.addEventListener('beforeunload', e => { if (dirty || pending) { e.preventDefault(); e.returnValue = ''; } });
  return {
    hasChanges() { return dirty; },
    setDirty(value) { dirty = value; const status = document.querySelector('#save-status'); if (status) status.textContent = value ? '有未保存的修改' : '所有修改已保存'; },
    setPending(value) { pending = value; },
    async canLeave() {
      if (pending) { document.querySelector('#message').textContent = '操作正在进行，请稍候'; document.querySelector('#message').hidden = false; return false; }
      if (!dirty) return true;
      if (resolveDecision) return false;
      dialog.showModal(); document.querySelector('#stay').focus();
      return new Promise(resolve => { resolveDecision = resolve; });
    },
  };
}
