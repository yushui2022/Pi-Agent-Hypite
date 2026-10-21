import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject, executePlan } from '../experiments/workers-p0/src/execution.ts';
const hash = 'a'.repeat(64);
const spec = () => ({
  schema: 'pi-studio.p0-project@1',
  shots: [1, 2, 3].map(i => ({ source: `shot-${i}.mp4`, startSeconds: 0, caption: 'Pi Studio' })),
  inputs: ['shot-1.mp4', 'shot-2.mp4', 'shot-3.mp4', 'voice.wav', 'music.wav', 'font.ttf'].map(name => ({ name, sha256: hash })),
});
test('P0 compiler rejects unsupported effects, missing inputs and off-frame cuts', async () => {
  for (const change of [s => { s.effects = ['fade']; }, s => s.inputs.pop(), s => { s.shots[0].startSeconds = .01; }]) {
    const s = spec(); change(s);
    await assert.rejects(compileProject(s, hash));
  }
});
test('P0 retries failed step, reuses verified shots and invalidates only changed dependencies', async () => {
  const first = await compileProject(spec(), hash);
  let saved, fail = true;
  const calls = [];
  const io = {
    save: async j => { saved = j; },
    execute: async step => {
      calls.push(step.id);
      if (fail && step.id === 'normalize-2') throw new Error('interruption');
      return { name: step.id === 'final' ? 'final.mp4' : step.id.replace('normalize-', 'render-') + '.mp4', sha256: hash, outputBytes: 1 };
    },
    verify: async () => true,
    validateFinal: async () => {},
  };
  await assert.rejects(executePlan(first, undefined, io), /interruption/);
  assert.equal(saved.status, 'failed');
  fail = false; calls.length = 0;
  await executePlan(first, saved, io);
  assert.deepEqual(calls, ['normalize-2', 'normalize-3', 'final']);
  const changed = spec(); changed.shots[1].caption = 'New caption';
  calls.length = 0;
  await executePlan(await compileProject(changed, hash), saved, io);
  assert.deepEqual(calls, ['normalize-2', 'final']);
  calls.length = 0;
  await executePlan(await compileProject(changed, hash), saved, io);
  assert.deepEqual(calls, []);
});
test('P0 does not mark invalid final media or unverified outputs complete', async () => {
  let saved;
  const plan = await compileProject(spec(), hash);
  const io = {
    save: async j => { saved = j; },
    execute: async step => ({ name: step.id === 'final' ? 'final.mp4' : step.id.replace('normalize-', 'render-') + '.mp4', sha256: hash, outputBytes: 1 }),
    verify: async () => true,
    validateFinal: async () => { throw new Error('bad video'); },
  };
  await assert.rejects(executePlan(plan, undefined, io), /bad video/);
  assert.equal(saved.status, 'failed');
  io.verify = async () => false;
  await assert.rejects(executePlan(plan, saved, io), /verification/);
  assert.equal(saved.status, 'failed');
});
