import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeRemixProject, remixProfile } from '../experiments/workers-p0/src/remix-bridge.ts';
import { compileProject } from '../experiments/workers-p0/src/execution.ts';
import { preparationProfile } from '../packages/remix/preparation.mjs';

const H = character => character.repeat(64);
const ENGINE = H('e');
const assets = () => [
  { id: 'asset_v1', name: 'a.mp4', mime: 'video/mp4', size: 1000, sha256: H('1'), available: true },
  { id: 'asset_v2', name: 'b.mp4', mime: 'video/mp4', size: 1000, sha256: H('2'), available: true },
  { id: 'asset_v3', name: 'c.mp4', mime: 'video/mp4', size: 1000, sha256: H('3'), available: true },
  { id: 'asset_img', name: 'p.png', mime: 'image/png', size: 1000, sha256: H('7'), available: true },
  { id: 'asset_voice', name: 'v.wav', mime: 'audio/wav', size: 1000, sha256: H('4'), available: true },
  { id: 'asset_music', name: 'm.mp3', mime: 'audio/mpeg', size: 1000, sha256: H('5'), available: true },
  { id: 'asset_font', name: 'f.ttf', mime: 'font/ttf', size: 1000, sha256: H('6'), available: true },
];
const plan = () => [
  { key: 'r1', type: 'video', start: 0, end: 5, assetId: 'asset_v1' },
  { key: 'r2', type: 'video', start: 5, end: 10, assetId: 'asset_v2' },
  { key: 'r3', type: 'video', start: 10, end: 15, assetId: 'asset_v3' },
  { key: 't1', type: 'text', start: 0, end: 5, value: '第一镜头字幕' },
  { key: 't2', type: 'text', start: 5, end: 10, value: '第二镜头字幕' },
  { key: 't3', type: 'text', start: 10, end: 15, value: '第三镜头字幕' },
  { key: 'a1', type: 'audio', start: 0, end: 15, assetId: 'asset_voice' },
  { key: 'a2', type: 'audio', start: 0, end: 15, assetId: 'asset_music' },
];
const base = () => ({
  projectId: 'remix_00000000-0000-0000-0000-000000000000',
  assets: assets(), rows: plan(),
  audio: { voice: 'asset_voice', music: 'asset_music' },
  font: { assetId: 'asset_font', sha256: H('6') },
});
const codes = result => result.issues.map(issue => issue.code);

test('bridge profile cannot silently drift from the preparation rules', () => {
  assert.equal(remixProfile.id, preparationProfile.id);
  for (const key of ['width', 'height', 'fps', 'durationSeconds', 'maxShots', 'maxCaptionLines', 'maxCaptionCharacters', 'maxUploadBytes']) {
    assert.equal(remixProfile[key], preparationProfile[key], key);
  }
});

test('a complete plan bridges to an engine spec the compiler actually accepts', async () => {
  const result = await bridgeRemixProject(base());
  assert.deepEqual(result.issues, []);
  assert.equal(result.status, 'ready');
  assert.equal(result.project.schema, 'pi-studio.project@2');
  assert.deepEqual(result.project.shots.map(shot => [shot.timelineStart, shot.durationSeconds, shot.caption]),
    [[0, 5, '第一镜头字幕'], [5, 5, '第二镜头字幕'], [10, 5, '第三镜头字幕']]);
  assert.deepEqual(result.uploads.map(upload => upload.name).sort(),
    ['font.ttf', 'music.wav', 'shot-1.mp4', 'shot-2.mp4', 'shot-3.mp4', 'voice.wav']);
  assert.equal(result.engine.contract, 'pi-studio.p0-project@1');
  assert.equal(result.engine.spec.inputs.length, 6);
  // The point of the bridge: its output is executable, not just describable.
  const compiled = await compileProject(result.engine.spec, ENGINE);
  assert.deepEqual(compiled.steps.map(step => step.id), ['normalize-1', 'normalize-2', 'normalize-3', 'final']);
});

test('identical plans bridge to the same key; changing one caption changes it', async () => {
  const first = await bridgeRemixProject(base());
  const again = await bridgeRemixProject(base());
  assert.equal(first.key, again.key);
  const changed = base();
  changed.rows[4].value = '改过的字幕';
  const next = await bridgeRemixProject(changed);
  assert.notEqual(next.key, first.key);
});

test('a visual gap is rejected instead of being filled from the reference video', async () => {
  const input = base();
  input.rows = [
    { key: 'r1', type: 'video', start: 0, end: 5, assetId: 'asset_v1' },
    { key: 'r2', type: 'video', start: 7, end: 12, assetId: 'asset_v2' },
    { key: 'r3', type: 'video', start: 12, end: 15, assetId: 'asset_v3' },
  ];
  const result = await bridgeRemixProject(input);
  assert.equal(result.status, 'needs-changes');
  assert.equal(result.project, null);
  assert.equal(result.engine, null);
  assert.ok(codes(result).includes('visual.gap'), codes(result).join(','));
});

test('audio roles must be declared, not inferred from the replacement table', async () => {
  const missingRole = base();
  missingRole.audio = { music: 'asset_music' };
  const declared = await bridgeRemixProject(missingRole);
  assert.equal(declared.status, 'needs-changes');
  assert.ok(declared.issues.some(issue => issue.code === 'asset.unassigned' && issue.role === 'voice'), codes(declared).join(','));

  const undeclaredRow = base();
  undeclaredRow.rows.push({ key: 'a3', type: 'audio', start: 0, end: 15, assetId: 'asset_v1' });
  const extra = await bridgeRemixProject(undeclaredRow);
  assert.equal(extra.status, 'needs-changes');
  assert.ok(codes(extra).includes('audio.undeclared'), codes(extra).join(','));

  const unused = base();
  unused.rows = unused.rows.filter(row => row.key !== 'a2');
  const unusedResult = await bridgeRemixProject(unused);
  assert.ok(codes(unusedResult).includes('audio.unused'), codes(unusedResult).join(','));
});

test('off-frame time and captions that do not match a shot boundary are plan errors', async () => {
  const offFrame = base();
  offFrame.rows[0].end = 5.01;
  const frameResult = await bridgeRemixProject(offFrame);
  assert.ok(codes(frameResult).includes('time.frame'), codes(frameResult).join(','));

  const partial = base();
  partial.rows = partial.rows.map(row => (row.key === 't1' ? { ...row, start: 1, end: 4 } : row));
  const partialResult = await bridgeRemixProject(partial);
  assert.equal(partialResult.status, 'needs-changes');
  assert.ok(codes(partialResult).includes('caption.boundary'), codes(partialResult).join(','));
});

test('a valid plan the current engine cannot render reports capability gaps, not a silent fallback', async () => {
  const uneven = base();
  uneven.rows = [
    { key: 'r1', type: 'video', start: 0, end: 7.44, assetId: 'asset_v1' },
    { key: 'r2', type: 'video', start: 7.44, end: 15, assetId: 'asset_v2' },
    { key: 't1', type: 'text', start: 0, end: 7.44, value: '第一段' },
    { key: 't2', type: 'text', start: 7.44, end: 15, value: '第二段' },
    { key: 'a1', type: 'audio', start: 0, end: 15, assetId: 'asset_voice' },
    { key: 'a2', type: 'audio', start: 0, end: 15, assetId: 'asset_music' },
  ];
  const result = await bridgeRemixProject(uneven);
  assert.equal(result.status, 'engine-unsupported');
  assert.equal(result.engine, null);
  assert.ok(result.project, '业务工程仍然要保留，供后续引擎升级后执行');
  assert.ok(codes(result).includes('engine.shot-count'), codes(result).join(','));
  assert.ok(codes(result).includes('engine.shot-duration'), codes(result).join(','));

  const image = base();
  image.rows[0] = { key: 'r1', type: 'image', start: 0, end: 5, assetId: 'asset_img' };
  const imageResult = await bridgeRemixProject(image);
  assert.ok(codes(imageResult).includes('engine.source-format'), codes(imageResult).join(','));

  const untrimmable = base();
  untrimmable.rows = untrimmable.rows.map(row => (row.key === 'a1' ? { ...row, end: 5 } : row));
  const trimResult = await bridgeRemixProject(untrimmable);
  assert.ok(codes(trimResult).includes('engine.audio-trim'), codes(trimResult).join(','));
});

test('missing subtitle for a shot and missing assets never become implicit defaults', async () => {
  const noCaption = base();
  noCaption.rows = noCaption.rows.filter(row => row.key !== 't2');
  const captionResult = await bridgeRemixProject(noCaption);
  assert.equal(captionResult.status, 'engine-unsupported');
  assert.ok(codes(captionResult).includes('engine.caption-required'), codes(captionResult).join(','));

  const noFont = base();
  noFont.font = undefined;
  const fontResult = await bridgeRemixProject(noFont);
  assert.equal(fontResult.status, 'needs-changes');
  assert.ok(fontResult.issues.some(issue => issue.code === 'asset.unassigned' && issue.role === 'font'), codes(fontResult).join(','));

  const missingMedia = base();
  missingMedia.assets = missingMedia.assets.map(asset => (asset.id === 'asset_v2' ? { ...asset, available: false } : asset));
  const mediaResult = await bridgeRemixProject(missingMedia);
  assert.equal(mediaResult.status, 'needs-changes');
  assert.ok(codes(mediaResult).includes('asset.missing'), codes(mediaResult).join(','));
});
