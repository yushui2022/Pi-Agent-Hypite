import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { matrixFixtures } from './matrix-fixtures.mjs';
import { localRuntime, localToken } from './local-runtime.mjs';
import { output, dist } from './paths.mjs';
import { verifyVideo } from './verify-video.mjs';

const core = JSON.parse(await readFile(path.join(dist, 'core-provenance.json'), 'utf8'));
assert.equal(core.minimalBuild, true, 'Run build:minimal first');
const inputs = await matrixFixtures();
const suiteDir = path.join(output, `matrix-${Date.now()}`);
await mkdir(suiteDir, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const font = await readFile(path.join(output, 'font-source/cjk-common.ttf'));
await writeFile(path.join(suiteDir, 'provenance.json'), JSON.stringify({ core, workerSha256: digest(await readFile(path.join(dist, 'media/worker.js'))),
  font: { bytes: font.length, sha256: digest(font) }, inputs: inputs.cases, environment: 'local-workerd', cloudAccepted: false }, null, 2));
const runtime = localRuntime('media');
const reports = [];
const captions = ['清爽随行，开启轻盈一天\n现在入手，优惠 20%', '自然质感，看得见的细节\n商品亮点，一目了然', '为你的品牌，制作新版本\n十五秒，留下好印象'];
const invoke = body => runtime.dispatchFetch('https://p0.invalid/run', { method: 'POST', headers: { authorization: `Bearer ${localToken}` }, body: JSON.stringify(body) });
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const run = (bin, args) => execFileSync(bin, bin === ffmpeg ? ['-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args] : args, { timeout: 120_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
try {
  const bucket = await runtime.getR2Bucket('ARTIFACTS');
  await bucket.put('fixtures/font.ttf', font);
  for (const name of ['voice.wav', 'music.wav']) await bucket.put(`fixtures/${name}`, await readFile(path.join(output, 'fixtures', name)));
  let acceptedIndex = 0;
  for (const item of inputs.cases) {
    const shot = item.accepted ? acceptedIndex % 3 + 1 : 1;
    await bucket.put(`fixtures/shot-${shot}.mp4`, await readFile(path.join(inputs.dir, `${item.id}.mp4`)));
    const response = await invoke({ id: 'matrix', operation: `normalize-${shot}`, caption: captions[shot - 1], startSeconds: item.startSeconds || 0 });
    const report = await response.json();
    reports.push({ case: item.id, expectedAcceptance: item.accepted, httpStatus: response.status, ...report });
    await writeFile(path.join(suiteDir, 'matrix.json'), JSON.stringify({ cloudAccepted: false, complete: false, reports }, null, 2));
    console.log(`${item.id}: ${response.status} ${report.error || `${report.outputBytes} bytes; tracked ${report.trackedBytesAtArchive}`}`);
    if (!item.accepted) { assert.equal(response.status, 422); assert.ok(report.error.includes(item.error), report.error); continue; }
    assert.equal(response.status, 200, JSON.stringify(report));
    acceptedIndex++;
    const artifact = await bucket.get(`runs/matrix/${report.name}`);
    const bytes = new Uint8Array(await artifact.arrayBuffer());
    assert.equal(digest(bytes), report.sha256);
    const file = path.join(suiteDir, `${item.id}.mp4`);
    await writeFile(file, bytes);
    const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
    assert.deepEqual(probe.streams.map(s => s.codec_type), ['video'], 'shots should not redundantly encode audio');
    const stream = probe.streams[0];
    assert.deepEqual([stream.width, stream.height, stream.r_frame_rate, Number(stream.nb_frames)], [720, 1280, '25/1', 125]);
    assert.ok(Math.abs(Number(probe.format.duration) - 5) < 0.04);
    run(ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
    run(ffmpeg, ['-v', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', path.join(suiteDir, `${item.id}.png`)]);
  }
  // Final combines the latest valid normalized shots, even after rejected inputs.
  const response = await invoke({ id: 'matrix', operation: 'final' });
  const final = await response.json();
  assert.equal(response.status, 200, JSON.stringify(final));
  await writeFile(path.join(suiteDir, 'final.mp4'), new Uint8Array(await (await bucket.get('runs/matrix/final.mp4')).arrayBuffer()));
  await writeFile(path.join(suiteDir, 'report.json'), JSON.stringify({ reports: [...reports.filter(r => r.httpStatus === 200), final] }, null, 2));
  const verification = await verifyVideo(path.join(suiteDir, 'final.mp4'), { snapshot: true });
  // Unsupported text / overlong captions / invalid seek fail before encoding.
  for (const [caption, startSeconds, status] of [['🙂', 0, 422], ['一'.repeat(16), 0, 422], ['a\nb\nc', 0, 400], ['正常文字', -1, 400]]) {
    assert.equal((await invoke({ id: 'bad-caption', operation: 'normalize-1', caption, startSeconds })).status, status);
    assert.equal(await bucket.head('runs/bad-caption/render-1.mp4'), null);
  }
  await bucket.put('fixtures/shot-1.mp4', await readFile(path.join(inputs.dir, 'landscape-30.mp4')));
  await bucket.put('fixtures/font.ttf', await readFile(path.join(output, 'font-source/p0-subset.ttf')));
  const missingGlyph = await invoke({ id: 'missing-glyph', operation: 'normalize-1', caption: '新品上市' });
  assert.equal(missingGlyph.status, 422);
  assert.match((await missingGlyph.json()).error, /Font does not contain/);
  assert.equal(await bucket.head('runs/missing-glyph/render-1.mp4'), null);
  await writeFile(path.join(suiteDir, 'matrix.json'), JSON.stringify({ cloudAccepted: false, complete: true, passed: true, cases: reports.length, captionAdmissionCases: 5, reports, final, verification }, null, 2));
} finally { await runtime.dispose(); console.log(`Matrix evidence: ${suiteDir}`); }
