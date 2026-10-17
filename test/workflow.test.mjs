import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createJob, showJob, inspectJob, jobDirectory } from '../packages/jobs/index.mjs';
import { inspectSource } from '../packages/hypit-adapter/index.mjs';

const temp = process.env.TEST_TEMP_ROOT || 'G:/DevCache/Temp/pi-agent-hypite/tests';
await mkdir(temp, { recursive: true });
const root = await mkdtemp(path.join(temp, 'run-'));
const config = { dataRoot: path.join(root, 'jobs'), tempRoot: root };
const brief = { title: '测试', account: 'test', product: 'sample', language: 'zh-CN', requirements: 'test', technicalSample: true, references: [] };

test('任务可重新读取，独立目录并保留技术样例标记', async () => {
  const a = await createJob(config, brief);
  const b = await createJob(config, { ...brief, title: 'second' });
  assert.notEqual(a.id, b.id);
  const saved = await showJob(config, a.id);
  assert.deepEqual(saved.brief, brief);
  assert.equal(saved.status, 'draft');
  assert.equal(saved.technicalSample, true);
  assert.deepEqual(saved.inspections, []);
});
test('拒绝无效 Brief、伪造 ID 和越界入口', async () => {
  await assert.rejects(createJob(config, { ...brief, title: '' }), /title/);
  await assert.rejects(jobDirectory(config, '../outside'), /Invalid job ID/);
  const job = await createJob(config, brief);
  await assert.rejects(inspectJob(config, job.id, 'check', '../brief.json'), /escapes/);
  await assert.rejects(inspectJob(config, job.id, 'build', 'main.svml'), /Only check and plan/);
});

async function fixture(body) {
  const file = path.join(root, `${crypto.randomUUID()}.mjs`);
  await writeFile(file, body);
  return file;
}
async function invoke(body, options = {}) {
  return inspectSource({ cli: await fixture(body), workspace: root, source: path.join(root, 'main.svml'), operation: 'check', tempRoot: root, ...options });
}
test('有效 JSON 仍需退出码与 ok 同时通过；未知协议不能误报成功', async () => {
  const good = await invoke('console.log(JSON.stringify({ format: "hypit.cli-check@1", ok: true }));');
  assert.equal(good.ok, true);
  const failed = await invoke('console.log(JSON.stringify({ format: "hypit.cli-check@1", ok: true })); process.exitCode = 1;');
  assert.equal(failed.ok, false);
  const unknown = await invoke('console.log(JSON.stringify({ format: "future@2", ok: true }));');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'unsupported_response');
});
test('保留 Hypit 业务错误；拒绝坏 JSON；超时和输出上限返回失败', async () => {
  const rejected = await invoke('console.log(JSON.stringify({ format: "hypit.cli-error@1", ok: false, error: {message: "broken source"} })); process.exitCode = 1;');
  assert.equal(rejected.error, 'hypit_error');
  assert.equal(rejected.data.error.message, 'broken source');
  const invalid = await invoke('console.log("not json");');
  assert.equal(invalid.error, 'invalid_json');
  const timeout = await invoke('setInterval(() => {}, 1000);', { timeoutMs: 300 });
  assert.equal(timeout.error, 'timeout');
  assert.equal(timeout.ok, false);
  const overflow = await invoke('console.log("x".repeat(5000));', { maxBytes: 1000 });
  assert.equal(overflow.error, 'output_limit');
});
