import {api} from './api.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function preparationPanel(batchId = '') {
  return `<section class="preparation-panel" data-preparation="${escape(batchId)}" aria-label="${batchId ? '批次' : '方案'}检查">
    <div class="preparation-heading"><div><h3>${batchId ? '批次规格检查' : '方案规格检查'}</h3><p class="muted">15 秒 · 720p · 最多三个主画面镜头。检查已保存内容，不提交制作。</p></div>
    <button type="button" data-check-preparation>${batchId ? '检查此批次' : '检查已保存方案'}</button></div>
    <div data-preparation-result aria-live="polite"></div></section>`;
}

export function bindPreparation({root, project, guard, isCurrent, navigateTab, inspectSnapshot}) {
  root.querySelectorAll('[data-preparation]').forEach(panel => {
    const button = panel.querySelector('[data-check-preparation]');
    const result = panel.querySelector('[data-preparation-result]');
    const batchId = panel.dataset.preparation;
    button.onclick = async () => {
      if (guard.hasChanges()) { result.textContent = '有未保存的修改，请先保存后再检查。'; return; }
      const parent = root.querySelector('#remix-panel');
      guard.setPending(true);
      parent.inert = true;
      button.setAttribute('aria-busy', 'true');
      result.textContent = '正在核对方案、批次快照和素材文件…';
      try {
        const report = await api(`/api/remix/${project.id}/check`, 'POST', {revision: project.revision, ...(batchId ? {batchId} : {})});
        if (!isCurrent() || !panel.isConnected) return;
        renderReport(result, report, {navigateTab: async (...args) => {
          if (await guard.canLeave()) navigateTab(...args);
        }, inspectSnapshot});
      } catch (error) {
        if (isCurrent() && panel.isConnected) result.textContent = `${error.message}。可重新检查；项目版本有变化时请重新打开项目。`;
      } finally {
        guard.setPending(false);
        parent.inert = false;
        button.removeAttribute('aria-busy');
      }
    };
  });
}

function renderReport(root, report, {navigateTab, inspectSnapshot}) {
  root.innerHTML = `<div class="preparation-summary"><strong>${report.totals.errors ? '有内容需要完善' : '已完成规格检查'}</strong>
    <span>${report.variants.length} 个版本 · ${report.totals.errors} 项需修改 · ${report.totals.warnings} 项提醒</span></div>
    <p class="muted">${report.source === 'batch-snapshot' ? '依据此批次保存时的方案与版本检查。' : '依据当前已保存方案检查。'} 未验证媒体解码和生成效果。</p>
    ${report.issues.length ? `<ol class="preparation-issues">${report.issues.map((issue, index) => `<li data-severity="${issue.severity}">
      <span class="preparation-level">${issue.severity === 'error' ? '需修改' : '提醒'}</span><div>
      <strong>${escape([issue.variantLabel, issue.rowKey].filter(Boolean).join(' / ') || '项目资料')}</strong><p>${escape(issue.message)}</p></div>
      <button type="button" data-fix-issue="${index}">${issue.tab === 'assets' ? '查看素材' : report.batchId ? '查看快照' : '定位替换位置'}</button></li>`).join('')}</ol>` : '<p>未发现素材引用、时间段与字幕规则问题。</p>'}
    ${report.truncated ? '<p>问题较多，页面展示前 500 项；请先修复共同问题后重新检查。</p>' : ''}
    <details class="preparation-timeline"><summary>查看主画面时间安排</summary>${report.variants.map(variant => `<section><h4>${escape(variant.variantLabel)}</h4><ol>${variant.visualShots.map(shot => `<li><time>${shot.start}–${shot.end} 秒</time> ${escape(shot.key)}</li>`).join('') || '<li>尚未配置主画面替换</li>'}</ol></section>`).join('')}</details>
    <div class="preparation-footer"><span class="muted">检查结果不代表已制作或可以执行。</span><button type="button" data-export-check>导出检查报告</button></div>`;
  root.querySelectorAll('[data-fix-issue]').forEach(button => {
    button.onclick = () => {
      const issue = report.issues[Number(button.dataset.fixIssue)];
      if (report.batchId && issue.tab !== 'assets') inspectSnapshot(report.batchId);
      else navigateTab(issue.tab === 'assets' ? 'assets' : 'plan', issue.rowIndex);
    };
  });
  root.querySelector('[data-export-check]').onclick = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `方案检查-${report.batchId || report.projectId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
