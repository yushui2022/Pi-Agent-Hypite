// Read-only preparation rules. No media decoding, model calls or execution claims.
export const preparationProfile = Object.freeze({
  id: 'video-remix-15s-v1', durationSeconds: 15, fps: 25,
  width: 720, height: 1280, maxShots: 3, maxVariants: 20,
  maxUploadBytes: 100_000_000, maxCaptionLines: 2, maxCaptionCharacters: 15,
});

export function inspectPreparation(project, {batchId, revision, checkedAt = new Date().toISOString()} = {}) {
  const batch = batchId ? project.batches.find(item => item.id === batchId) : null;
  if (batchId && !batch) throw Object.assign(new Error('批次不存在'), {status: 404});
  const plan = batch?.plan || project.plan;
  const variants = batch?.variants || [{id: 'current-plan', label: '当前方案', rows: plan.rows}];
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const issues = [], summaries = [], totals = {errors: 0, warnings: 0};
  const add = (severity, code, message, details = {}) => {
    totals[severity === 'error' ? 'errors' : 'warnings']++;
    if (issues.length < 500) issues.push({severity, code, message, ...details});
  };
  const assetChecks = new Map();
  function assetIssue(id, type, details, reference = false) {
    const asset = assets.get(id);
    if (!asset || !asset.mime?.startsWith(type + '/')) {
      add('error', 'asset.unassigned', reference ? '请选择已导入的参考视频。' : '尚未分配匹配类型的素材。', {...details, tab: 'assets'});
      return;
    }
    assetChecks.set(id, {assetId: id, name: asset.name, size: asset.size, expectedSha256: asset.sha256, hashVerified: false, available: asset.available === true});
    if (!asset.available) add('error', 'asset.missing', `素材「${asset.name}」缺失或大小已变化，请重新导入。`, {...details, assetId: id, tab: 'assets'});
    if (asset.size >= preparationProfile.maxUploadBytes) add('error', 'asset.too-large', `素材「${asset.name}」达到或超过首版 100 MB 限制。`, {...details, assetId: id, tab: 'assets'});
    if (type === 'video' && !/\.mp4$/i.test(asset.name)) add('error', 'asset.format', `视频「${asset.name}」需先转换为 H.264 MP4；现有记录保留。`, {...details, assetId: id, tab: 'assets'});
  }
  assetIssue(plan.referenceId, 'video', {}, true);
  if (variants.length > preparationProfile.maxVariants) add('error', 'batch.limit', `本批有 ${variants.length} 个版本，请拆分为每批最多 20 个；历史批次不会被删除。`, {tab: 'batches'});
  const combinations = new Map();
  for (const variant of variants) {
    const before = {...totals};
    const scope = {variantId: variant.id, variantLabel: variant.label};
    const rows = variant.rows || [];
    const visual = [], text = [];
    let audioCount = 0;
    if (!rows.length) add('error', 'plan.empty', '尚未添加替换位置。', {...scope, tab: 'plan'});
    for (const [rowIndex, row] of rows.entries()) {
      const details = {...scope, rowIndex, rowKey: row.key, tab: 'plan'};
      const start = Number(row.start), end = Number(row.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 15) {
        add('error', 'time.range', '替换时间段必须在 0–15 秒内，且结束晚于开始。', details);
      } else {
        if ([start, end].some(time => Math.abs(time * 25 - Math.round(time * 25)) > 0.000001)) add('error', 'time.frame', '时间需对齐 25 fps 的帧边界（0.04 秒的整数倍）。', details);
        if (['video', 'image'].includes(row.type)) visual.push({start, end, rowIndex, key: row.key, type: row.type});
        if (row.type === 'text') text.push({start, end, rowIndex, key: row.key});
      }
      if (row.type === 'text') {
        const value = typeof row.value === 'string' ? row.value.replace(/\r\n/g, '\n').trim() : '';
        if (!value) add('error', 'caption.empty', '字幕文案尚未填写。', details);
        else {
          const lines = value.split('\n');
          if (lines.length > 2 || lines.some(line => !line.trim())) add('error', 'caption.lines', '固定字幕样式最多两行，不能包含空行。', details);
          if (lines.some(line => [...line].length > 15)) add('error', 'caption.width', '字幕每行最多 15 个字符（含空格），请精简或换行。', details);
          if (!/^[\x20-\x7e\u00a0-\u00ff\u2000-\u200a\u2010-\u2027\u2030-\u205f\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\n]+$/u.test(value)) add('error', 'caption.characters', '字幕包含当前固定字体方案不支持的字符或不可见控制符。', details);
        }
      } else if (['video', 'image', 'audio'].includes(row.type)) {
        assetIssue(row.assetId, row.type, details);
        if (row.type === 'audio') audioCount++;
      } else add('error', 'row.type', '替换类型不受支持。', details);
    }
    visual.sort((a, b) => a.start - b.start || a.end - b.end);
    const gaps = [];
    let cursor = 0;
    for (const shot of visual) {
      if (shot.start < cursor - 0.000001) add('error', 'visual.overlap', `「${shot.key}」与其他主画面重叠，请调整时间。`, {...scope, rowIndex: shot.rowIndex, rowKey: shot.key, tab: 'plan'});
      if (shot.start > cursor + 0.000001) gaps.push({start: cursor, end: shot.start});
      cursor = Math.max(cursor, shot.end);
    }
    if (cursor < 15 - 0.000001) gaps.push({start: cursor, end: 15});
    if (visual.length > 3) add('error', 'visual.count', '首版主画面最多三个镜头，请合并或减少替换位置。', {...scope, tab: 'plan'});
    if (gaps.length) add('warning', 'visual.gaps', `以下区间未标注主画面替换：${gaps.map(gap => `${gap.start}–${gap.end} 秒`).join('、')}。制作前需明确保留参考还是补充素材。`, {...scope, tab: 'plan'});
    text.sort((a, b) => a.start - b.start);
    let textEnd = 0;
    for (const caption of text) {
      if (caption.start < textEnd - 0.000001) add('error', 'caption.overlap', `「${caption.key}」与其他字幕重叠，首版只支持一条字幕轨。`, {...scope, rowIndex: caption.rowIndex, rowKey: caption.key, tab: 'plan'});
      textEnd = Math.max(textEnd, caption.end);
    }
    if (audioCount > 2) add('error', 'audio.count', '首版支持一条配音和一条音乐，请减少音频替换项。', {...scope, tab: 'plan'});
    if (audioCount) add('warning', 'audio.roles', '音频用途还需在制作工程中区分为配音和背景音乐；当前替换表未保存此配置。', {...scope, tab: 'plan'});
    // Compare content, not variant labels, row labels or ordering. This is a
    // duplicate-plan hint; it does not claim visual similarity or cache reuse.
    const signature = JSON.stringify(rows.map(row => [row.type, Number(row.start), Number(row.end), row.type === 'text' ? row.value : row.assetId]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if (combinations.has(signature)) add('warning', 'variant.duplicate', `素材、时间和文案与「${combinations.get(signature)}」相同，改名不会形成新的内容组合。`, {...scope, tab: 'batches'});
    else combinations.set(signature, variant.label);
    summaries.push({...scope, errors: totals.errors - before.errors, warnings: totals.warnings - before.warnings, visualShots: visual, gaps});
  }
  return {
    schema: 'pi-studio.preparation@1', profile: preparationProfile, projectId: project.id,
    revision, batchId: batch?.id || null, source: batch ? 'batch-snapshot' : 'saved-plan', checkedAt,
    status: totals.errors ? 'needs-changes' : 'checked', canExecute: false,
    totals, issueCount: totals.errors + totals.warnings, truncated: totals.errors + totals.warnings > issues.length,
    issues, variants: summaries, assets: [...assetChecks.values()],
    pendingChecks: ['实际编码、时长、分辨率与完整解码', '字幕实际字形、音画同步与内容质量', '云端执行能力、费用与容量'],
  };
}
