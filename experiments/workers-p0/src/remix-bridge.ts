// Bridge from a saved remix plan to a versioned engine project.
// Deliberately strict: no implicit assets, no default audio role, no default font,
// no gap filling (a gap is never silently filled from the reference video), and no
// silent downgrade when the current engine cannot render an otherwise valid plan.
// Web Crypto only, so this can move into a Worker unchanged.

export const remixProfile = Object.freeze({
  id: 'video-remix-15s-v1' as const,
  width: 720, height: 1280, fps: 25, durationSeconds: 15,
  maxShots: 3, maxCaptionLines: 2, maxCaptionCharacters: 15,
  maxUploadBytes: 100_000_000,
});

export type RemixAsset = { id: string; name: string; mime: string; size: number; sha256: string; available: boolean };
export type RemixRow = { key?: string; type: string; start: number; end: number; assetId?: string; value?: string };
export type BridgeInput = {
  projectId: string;
  assets: RemixAsset[];
  rows: RemixRow[];
  // Audio roles are declared, never inferred from row order or asset names.
  audio?: { voice?: string; music?: string };
  font?: { assetId?: string; sha256?: string };
};

export type Issue = { code: string; kind: 'plan' | 'capability'; message: string; [detail: string]: unknown };
export type ShotV2 = {
  index: number; timelineStart: number; durationSeconds: number;
  sourceAssetId: string; sourceSha256: string; sourceStartSeconds: number;
  caption: string | null;
};
export type ProjectV2 = {
  schema: 'pi-studio.project@2';
  profile: typeof remixProfile.id;
  width: number; height: number; fps: number; durationSeconds: number;
  shots: ShotV2[];
  audio: { voice: { assetId: string; sha256: string }; music: { assetId: string; sha256: string } };
  font: { assetId: string; sha256: string };
};
export type EngineSpec = {
  schema: 'pi-studio.p0-project@1';
  shots: { source: string; startSeconds: number; caption: string }[];
  inputs: { name: string; sha256: string }[];
};
export type Upload = { name: string; assetId: string; sha256: string; mediaType: string };
export type BridgeResult = {
  schema: 'pi-studio.mapping@1';
  projectId: string;
  status: 'needs-changes' | 'engine-unsupported' | 'ready';
  key: string | null;
  project: ProjectV2 | null;
  uploads: Upload[];
  engine: { contract: 'pi-studio.p0-project@1'; spec: EngineSpec } | null;
  issues: Issue[];
  pendingChecks: string[];
};

const HEX = /^[a-f0-9]{64}$/;
const CAPTION_CHARS = /^[\x20-\x7e\u00a0-\u00ff\u2000-\u200a\u2010-\u2027\u2030-\u205f\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\n]+$/u;
const onFrame = (value: number) => Math.abs(value * remixProfile.fps - Math.round(value * remixProfile.fps)) <= 1e-6;
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map(n => n.toString(16).padStart(2, '0')).join('');

const PENDING = Object.freeze([
  '参考视频理解与替换决策（需真实模型调用）',
  '实际解码、帧对齐、字幕字形与音画同步',
  '云端执行能力、内存上限与费用',
]);

export async function bridgeRemixProject(input: BridgeInput): Promise<BridgeResult> {
  const assets = new Map<string, RemixAsset>();
  for (const asset of Array.isArray(input.assets) ? input.assets : []) if (asset && typeof asset.id === 'string') assets.set(asset.id, asset);
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const issues: Issue[] = [];
  const planIssue = (code: string, message: string, detail: Record<string, unknown> = {}) => issues.push({ code, kind: 'plan', message, ...detail });
  const capabilityIssue = (code: string, message: string, detail: Record<string, unknown> = {}) => issues.push({ code, kind: 'capability', message, ...detail });

  const checkAsset = (assetId: unknown, allow: (mime: string) => boolean, label: string, detail: Record<string, unknown>) => {
    if (typeof assetId !== 'string' || !assetId) { planIssue('asset.unassigned', `${label}尚未指定素材。`, detail); return null; }
    const asset = assets.get(assetId);
    if (!asset) { planIssue('asset.unknown', `${label}引用的素材 ${assetId} 不在项目素材库中。`, detail); return null; }
    if (!HEX.test(String(asset.sha256))) { planIssue('asset.hash', `素材「${asset.name}」缺少有效内容哈希，无法登记。`, detail); return null; }
    if (asset.available !== true) { planIssue('asset.missing', `素材「${asset.name}」缺失或大小已变化，请重新导入。`, detail); return null; }
    if (!Number.isFinite(asset.size) || asset.size < 1) { planIssue('asset.empty', `素材「${asset.name}」大小为 0。`, detail); return null; }
    if (asset.size >= remixProfile.maxUploadBytes) { planIssue('asset.too-large', `素材「${asset.name}」达到或超过首版 100 MB 限制。`, detail); return null; }
    if (!allow(String(asset.mime))) { planIssue('asset.type', `素材「${asset.name}」类型与用途不符。`, { ...detail, mime: asset.mime }); return null; }
    return asset;
  };

  // ---- rows: time and content rules (business correctness) ----
  type Visual = { row: RemixRow; asset: RemixAsset; start: number; end: number };
  type Text = { row: RemixRow; start: number; end: number; value: string };
  const visuals: Visual[] = [];
  const texts: Text[] = [];
  const audioRows: { row: RemixRow; assetId: string }[] = [];

  for (const [rowIndex, row] of rows.entries()) {
    const detail = { rowIndex, rowKey: row?.key };
    const start = Number(row?.start), end = Number(row?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > remixProfile.durationSeconds) {
      planIssue('time.range', '替换时间段必须在 0–15 秒内，且结束晚于开始。', detail);
      continue;
    }
    if (!onFrame(start) || !onFrame(end)) { planIssue('time.frame', '时间需对齐 25 fps 的帧边界（0.04 秒的整数倍）。', detail); continue; }
    if (['video', 'image'].includes(row.type)) {
      const asset = checkAsset(row.assetId, mime => mime.startsWith('video/') || mime.startsWith('image/'), '主画面', detail);
      if (asset) visuals.push({ row, asset, start, end });
    } else if (row.type === 'text') {
      const value = typeof row.value === 'string' ? row.value.replace(/\r\n/g, '\n').trim() : '';
      const lines = value.split('\n');
      if (!value) planIssue('caption.empty', '字幕文案尚未填写。', detail);
      else if (lines.length > remixProfile.maxCaptionLines || lines.some(line => !line.trim())) planIssue('caption.lines', '固定字幕样式最多两行，不能包含空行。', detail);
      else if (lines.some(line => [...line].length > remixProfile.maxCaptionCharacters)) planIssue('caption.width', `字幕每行最多 ${remixProfile.maxCaptionCharacters} 个字符。`, detail);
      else if (!CAPTION_CHARS.test(value)) planIssue('caption.characters', '字幕包含固定字体方案不支持的字符或不可见控制符。', detail);
      else texts.push({ row, start, end, value });
    } else if (row.type === 'audio') {
      if (typeof row.assetId === 'string') audioRows.push({ row, assetId: row.assetId });
      else planIssue('asset.unassigned', '音频替换尚未指定素材。', detail);
    } else planIssue('row.type', '替换类型不受支持。', detail);
  }

  // ---- visual timeline must tile 0–15 with no gap and no overlap ----
  visuals.sort((a, b) => a.start - b.start || a.end - b.end);
  if (visuals.length > remixProfile.maxShots) planIssue('visual.count', `首版主画面最多 ${remixProfile.maxShots} 个镜头。`, { shots: visuals.length });
  let cursor = 0;
  for (const visual of visuals) {
    if (visual.start > cursor + 1e-6) planIssue('visual.gap', `第 ${cursor}–${visual.start} 秒没有主画面素材。请补齐替换位置，不会自动用参考视频填充。`, { start: cursor, end: visual.start });
    else if (visual.start < cursor - 1e-6) planIssue('visual.overlap', '主画面替换区间重叠。', { start: visual.start, end: visual.end });
    cursor = Math.max(cursor, visual.end);
  }
  if (!visuals.length) planIssue('visual.empty', '尚未添加主画面替换位置。');
  else if (cursor < remixProfile.durationSeconds - 1e-6) planIssue('visual.gap', `第 ${cursor}–${remixProfile.durationSeconds} 秒没有主画面素材。请补齐替换位置，不会自动用参考视频填充。`, { start: cursor, end: remixProfile.durationSeconds });

  // ---- one caption track, aligned to shot boundaries (engine burns one caption per shot) ----
  texts.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < texts.length; i++) {
    if (texts[i].start < texts[i - 1].end - 1e-6) planIssue('caption.overlap', '同一时间只能有一条字幕轨。', { start: texts[i].start, end: texts[i].end });
  }

  // ---- audio: exactly one declared voice and one declared music, both used ----
  const declared = input.audio || {};
  const voice = checkAsset(declared.voice, mime => mime.startsWith('audio/'), '配音', { role: 'voice' });
  const music = checkAsset(declared.music, mime => mime.startsWith('audio/'), '背景音乐', { role: 'music' });
  if (voice && music && voice.id === music.id) planIssue('audio.same', '配音与背景音乐不能使用同一个素材。');
  for (const audio of audioRows) {
    if (![declared.voice, declared.music].includes(audio.assetId)) planIssue('audio.undeclared', '音频替换项的素材未标注为配音或背景音乐。', { rowKey: audio.row.key, assetId: audio.assetId });
  }
  for (const [role, asset] of [['voice', voice], ['music', music]] as const) {
    if (asset && !audioRows.some(audio => audio.assetId === asset.id)) planIssue('audio.unused', `已声明 ${role === 'voice' ? '配音' : '背景音乐'}素材，但替换表中没有对应的音频项。`, { role });
  }

  // ---- font: explicit, no bundled default ----
  const declaredFont = input.font || {};
  const font = checkAsset(declaredFont.assetId, mime => mime.startsWith('font/') || /\.(ttf|otf)$/i.test(String(assets.get(String(declaredFont.assetId))?.name)), '字体', { role: 'font' });
  if (font && typeof declaredFont.sha256 === 'string' && declaredFont.sha256 !== font.sha256) planIssue('font.mismatch', '字体声明的哈希与素材登记不一致。');

  // ---- build the business project whenever the plan itself is sound ----
  const businessValid = !issues.some(issue => issue.kind === 'plan');
  let project: ProjectV2 | null = null;
  if (businessValid && voice && music && font) {
    const shots: ShotV2[] = visuals.map((visual, index) => {
      const candidate = texts.filter(text => Math.abs(text.start - visual.start) <= 1e-6 && Math.abs(text.end - visual.end) <= 1e-6);
      const partial = texts.filter(text => text.start < visual.end - 1e-6 && text.end > visual.start + 1e-6 && !candidate.includes(text));
      if (partial.length) planIssue('caption.boundary', '字幕区间必须与镜头边界完全对齐，当前引擎按镜头烧录一条字幕。', { shotIndex: index, start: partial[0].start, end: partial[0].end });
      if (candidate.length > 1) planIssue('caption.overlap', '同一镜头只能有一条字幕。', { shotIndex: index });
      return {
        index,
        timelineStart: visual.start,
        durationSeconds: visual.end - visual.start,
        sourceAssetId: visual.asset.id,
        sourceSha256: visual.asset.sha256,
        // profile video-remix-15s-v1 不使用素材内裁剪：主画面从素材 0 秒开始，这是契约语义，不是兜底默认值。
        sourceStartSeconds: 0,
        caption: candidate.length === 1 ? candidate[0].value : null,
      };
    });
    if (issues.some(issue => issue.kind === 'plan')) project = null;
    else project = {
      schema: 'pi-studio.project@2',
      profile: remixProfile.id,
      width: remixProfile.width, height: remixProfile.height,
      fps: remixProfile.fps, durationSeconds: remixProfile.durationSeconds,
      shots,
      audio: { voice: { assetId: voice.id, sha256: voice.sha256 }, music: { assetId: music.id, sha256: music.sha256 } },
      font: { assetId: font.id, sha256: font.sha256 },
    };
  }
  if (!project) return { schema: 'pi-studio.mapping@1', projectId: input.projectId, status: 'needs-changes', key: null, project: null, uploads: [], engine: null, issues, pendingChecks: [...PENDING] };

  // ---- capability check against the engine that actually exists today ----
  if (project.shots.length !== 3) capabilityIssue('engine.shot-count', `当前引擎固定三个镜头，该方案有 ${project.shots.length} 个。`, { shots: project.shots.length });
  for (const shot of project.shots) {
    if (Math.abs(shot.durationSeconds - 5) > 1e-6) capabilityIssue('engine.shot-duration', `当前引擎每个镜头固定 5 秒，第 ${shot.index + 1} 镜为 ${shot.durationSeconds} 秒。`, { shotIndex: shot.index, durationSeconds: shot.durationSeconds });
    if (shot.caption === null) capabilityIssue('engine.caption-required', `当前引擎每镜头必烧一条字幕，第 ${shot.index + 1} 镜没有。`, { shotIndex: shot.index });
    const source = assets.get(shot.sourceAssetId)!;
    if (!source.mime.startsWith('video/') || !/\.mp4$/i.test(source.name)) capabilityIssue('engine.source-format', `当前引擎只处理 H.264 MP4 主画面，「${source.name}」不是 MP4 视频。`, { shotIndex: shot.index, mime: source.mime });
    if (shot.sourceStartSeconds > 55) capabilityIssue('engine.source-offset', '当前引擎只支持素材内 55 秒以内的起点。', { shotIndex: shot.index });
  }

  // The engine mixes whole audio files; it cannot trim an audio row to a sub-range.
  for (const audio of audioRows) {
    if (Math.abs(audio.row.start) > 1e-6 || Math.abs(audio.row.end - remixProfile.durationSeconds) > 1e-6) {
      capabilityIssue('engine.audio-trim', '当前引擎按整条音轨混音，不支持把音频裁剪到片段区间。', { rowKey: audio.row.key, start: audio.row.start, end: audio.row.end });
    }
  }

  const uploads: Upload[] = [
    { name: 'voice.wav', assetId: project.audio.voice.assetId, sha256: project.audio.voice.sha256, mediaType: 'audio' },
    { name: 'music.wav', assetId: project.audio.music.assetId, sha256: project.audio.music.sha256, mediaType: 'audio' },
    { name: 'font.ttf', assetId: project.font.assetId, sha256: project.font.sha256, mediaType: 'font' },
    ...project.shots.map((shot, index) => {
      const source = assets.get(shot.sourceAssetId)!;
      return { name: `shot-${index + 1}.mp4`, assetId: shot.sourceAssetId, sha256: shot.sourceSha256, mediaType: source.mime };
    }),
  ];

  const key = await digest(project);
  if (issues.some(issue => issue.kind === 'capability')) {
    return { schema: 'pi-studio.mapping@1', projectId: input.projectId, status: 'engine-unsupported', key, project, uploads, engine: null, issues, pendingChecks: [...PENDING] };
  }

  const spec: EngineSpec = {
    schema: 'pi-studio.p0-project@1',
    shots: project.shots.map((shot, index) => ({ source: `shot-${index + 1}.mp4`, startSeconds: shot.sourceStartSeconds, caption: shot.caption! })),
    inputs: uploads.map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name)),
  };
  return { schema: 'pi-studio.mapping@1', projectId: input.projectId, status: 'ready', key, project, uploads, engine: { contract: 'pi-studio.p0-project@1', spec }, issues, pendingChecks: [...PENDING] };
}
