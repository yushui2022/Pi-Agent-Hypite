import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, createJob, showJob, inspectJob } from '../packages/jobs/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = await loadConfig(process.argv[2]);
const sample = path.join(root, 'examples/technical-sample');
const job = await createJob(config, JSON.parse(await readFile(path.join(sample, 'brief.json'), 'utf8')));
for (const file of ['main.svml', 'build.svrun', 'template.svs']) await copyFile(path.join(sample, file), path.join(job.directory, 'project', file));
const results = [];
for (const [operation, file] of [['check', 'main.svml'], ['check', 'build.svrun'], ['plan', 'build.svrun']]) {
  const record = await inspectJob(config, job.id, operation, file);
  assert.equal(record.ok, true, JSON.stringify(record));
  results.push({ operation, source: file, ok: record.ok, inspectionId: record.id });
}
await writeFile(path.join(job.directory, 'project/broken.svml'), '<not-valid>');
const broken = await inspectJob(config, job.id, 'check', 'broken.svml');
assert.equal(broken.ok, false);
const restored = await showJob(config, job.id);
assert.equal(restored.inspections.length, 4);
assert.equal(restored.status, 'draft');
await assert.rejects(inspectJob(config, job.id, 'check', '../brief.json'), /escapes/);
const sourceSnapshot = {};
for (const file of ['packages/jobs/index.mjs', 'packages/hypit-adapter/index.mjs', 'scripts/job.mjs', 'scripts/verify-integration.mjs', 'test/workflow.test.mjs']) {
  sourceSnapshot[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const report = { verifiedAt: new Date().toISOString(), sourceSnapshot, jobId: job.id, directory: job.directory, results, invalidSourceRejected: !broken.ok, persistedInspections: restored.inspections.length, traversalRejected: true, scope: 'Real local Hypit check/plan; text-only technical sample, no model, Build or video.' };
await mkdir(path.join(root, 'output'), { recursive: true });
await writeFile(path.join(root, 'output/integration-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
