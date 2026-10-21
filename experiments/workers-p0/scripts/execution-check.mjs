import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { compileProject, executePlan } from '../src/execution.ts';
import { benchmarkDriver } from './benchmark-driver.mjs';
import { output, dist } from './paths.mjs';
import { verifyVideo } from './verify-video.mjs';

const id = `execution-${Date.now()}`;
const dir = path.join(output, id);
await mkdir(dir, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const workerHash = digest(await readFile(path.join(dist, 'media/worker.js')));
const core = JSON.parse(await readFile(path.join(dist, 'core-provenance.json'), 'utf8'));
assert.equal(core.minimalBuild, true, 'Build the minimal media core first');
const manifest = JSON.parse(await readFile(path.join(output, 'fixtures/manifest.json'), 'utf8'));
const spec = {
  schema: 'pi-studio.p0-project@1',
  shots: [1, 2, 3].map(i => ({ source: `shot-${i}.mp4`, startSeconds: 0, caption: '字幕已烧录进视频\n本地技术验证 非生成成品' })),
  inputs: manifest.files.map(({ name, sha256 }) => ({ name, sha256 })),
};
const engine = digest(JSON.stringify({ workerHash, wasm: core.wasmSha256, contract: 'p0-execution@1' }));
let runtime = await benchmarkDriver(undefined, path.join(dir, 'r2'));
const calls = [];
const journalPath = path.join(dir, 'journal.json');
const save = async journal => {
  await writeFile(`${journalPath}.tmp`, JSON.stringify(journal, null, 2));
  await rename(`${journalPath}.tmp`, journalPath);
};
let interrupted = false;
const io = {
  save,
  execute: async step => {
    if (!interrupted && step.id === 'normalize-2') {
      interrupted = true;
      throw new Error('Intentional local interruption after first archived shot');
    }
    calls.push(step.id);
    const response = await runtime.run({ id, operation: step.operation, caption: step.caption, startSeconds: step.startSeconds });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    await writeFile(path.join(dir, `${step.id}-report.json`), JSON.stringify(result, null, 2));
    return { name: result.name, sha256: result.sha256, outputBytes: result.outputBytes };
  },
  verify: async artifact => {
    try {
      const saved = await runtime.download(id, artifact.name, path.join(dir, artifact.name));
      return saved.sha256 === artifact.sha256 && saved.bytes === artifact.outputBytes;
    } catch { return false; }
  },
  validateFinal: async () => {
    const reports = await Promise.all(['normalize-1', 'normalize-2', 'normalize-3', 'final'].map(async name =>
      JSON.parse(await readFile(path.join(dir, `${name}-report.json`), 'utf8'))));
    await writeFile(path.join(dir, 'report.json'), JSON.stringify({ environment: 'local-workerd', cloudAccepted: false, reports }, null, 2));
    await verifyVideo(path.join(dir, 'final.mp4'));
  },
};
try {
  for (const input of spec.inputs) {
    const bytes = await readFile(path.join(output, 'fixtures', input.name));
    assert.equal(digest(bytes), input.sha256, 'Frozen input differs from manifest');
    assert.equal((await runtime.upload(input.name, bytes)).sha256, input.sha256);
  }
  const plan = await compileProject(spec, engine);
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  await assert.rejects(executePlan(plan, undefined, io), /Intentional local interruption/);
  const failed = JSON.parse(await readFile(journalPath, 'utf8'));
  assert.equal(failed.status, 'failed');
  assert.deepEqual(Object.keys(failed.steps), ['normalize-1']);
  // Restart actual workerd; only the persisted R2 state and journal survive.
  await runtime.dispose();
  runtime = await benchmarkDriver(undefined, path.join(dir, 'r2'));
  calls.length = 0;
  const done = await executePlan(plan, failed, io);
  assert.deepEqual(calls, ['normalize-2', 'normalize-3', 'final']);
  const resumedCalls = [...calls];
  calls.length = 0;
  await executePlan(plan, done, io);
  assert.deepEqual(calls, []);
  const changed = structuredClone(spec);
  changed.shots[1].caption = '本地技术验证\n字幕已烧录进视频';
  const nextPlan = await compileProject(changed, engine);
  const revised = await executePlan(nextPlan, done, io);
  assert.deepEqual(calls, ['normalize-2', 'final']);
  await writeFile(path.join(dir, 'revised-plan.json'), JSON.stringify(nextPlan, null, 2));
  await writeFile(path.join(dir, 'artifact-manifest.json'), JSON.stringify({
    schema: 'pi-studio.p0-artifacts@1', environment: 'local-workerd', cloudAccepted: false,
    contentKind: 'synthetic-technical-sample', planKey: nextPlan.key, engine, core,
    artifacts: revised.steps, resumedCalls, duplicateExecutionCalls: [], revisedCalls: calls, cost: null,
  }, null, 2));
  console.log(`PASS: durable restart, verified reuse, 15s MP4; ${dir}`);
} finally { await runtime.dispose(); }
