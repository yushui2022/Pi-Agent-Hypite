import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { benchmarkDriver } from './benchmark-driver.mjs';
import { output, dist, root } from './paths.mjs';
import { verifyVideo } from './verify-video.mjs';

const operations = process.argv.slice(2);
let remote;
const remoteFlag = operations.indexOf('--remote');
if (remoteFlag !== -1) {
  remote = operations[remoteFlag + 1];
  if (!remote) throw new Error('--remote requires an HTTPS origin');
  operations.splice(remoteFlag, 2);
}
let repeat = 1;
const repeatFlag = operations.indexOf('--repeat');
if (repeatFlag !== -1) {
  repeat = Number(operations[repeatFlag + 1]);
  operations.splice(repeatFlag, 2);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error('repeat must be 1–20');
}
if (!operations.length) operations.push('version', 'concat', 'render-1', 'render-2', 'render-3', 'final');
const suiteId = `${remote ? 'remote' : 'local'}-${Date.now()}`;
const suiteDir = path.join(output, suiteId);
await mkdir(suiteDir, { recursive: true });
console.log(`Driver PID ${process.pid}; evidence ${suiteDir}`);
const hashFile = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const provenance = {
  createdAt: new Date().toISOString(), node: process.version,
  dependencies: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')),
  core: JSON.parse(await readFile(path.join(dist, 'core-provenance.json'), 'utf8')),
  workerSha256: await hashFile(path.join(dist, 'media/worker.js')),
  fixtureManifest: operations.some(op => op !== 'version') ? JSON.parse(await readFile(path.join(output, 'fixtures/manifest.json'), 'utf8')) : null,
};
const runtime = await benchmarkDriver(remote);
const runs = [];
try {
  const health = await runtime.health();
  if (health.core?.wasmSha256 !== provenance.core.wasmSha256) throw new Error('Target core differs from selected local build; refusing an untracked comparison');
  await writeFile(path.join(suiteDir, 'provenance.json'), JSON.stringify({ ...provenance, target: health, environment: runtime.environment, localWorkerHashIsDeploymentProof: !remote }, null, 2));
  if (operations.some(op => op !== 'version')) {
    const manifest = JSON.parse(await readFile(path.join(output, 'fixtures/manifest.json'), 'utf8'));
    for (const { name, sha256 } of manifest.files) {
      const uploaded = await runtime.upload(name, await readFile(path.join(output, 'fixtures', name)));
      if (uploaded.sha256 !== sha256) throw new Error(`Uploaded fixture hash mismatch: ${name}`);
    }
  }
  for (let iteration = 1; iteration <= repeat; iteration++) {
    const id = repeat === 1 ? suiteId : `${suiteId}-${iteration}`;
    const dir = repeat === 1 ? suiteDir : path.join(suiteDir, String(iteration).padStart(2, '0'));
    await mkdir(dir, { recursive: true });
    const reports = [];
    for (const operation of operations) {
    const started = Date.now();
    console.log(`Running ${iteration}/${repeat} ${operation} in ${runtime.environment}...`);
    const response = await runtime.run({ id, operation });
    const result = await response.json();
    reports.push({ ...result, httpStatus: response.status, driverElapsedMs: Date.now() - started, driverMemory: process.memoryUsage() });
    await writeFile(path.join(dir, 'report.json'), JSON.stringify({ environment: runtime.environment, cloudAccepted: false, id, reports }, null, 2));
    if (!response.ok) throw new Error(JSON.stringify(result));
    if (result.name) {
      const saved = await runtime.download(id, result.name, path.join(dir, result.name));
      if (result.sha256 && saved.sha256 !== result.sha256) throw new Error('Downloaded artifact hash mismatch');
      if (result.outputBytes && saved.bytes !== result.outputBytes) throw new Error('Downloaded artifact size mismatch');
    }
    console.log(JSON.stringify({ operation, elapsedMs: result.elapsedMs, heapMiB: result.heapFinal / 1024 / 1024, bytes: result.outputBytes, logs: operation === 'version' ? result.logs : undefined }));
    }
    if (operations.includes('final')) await verifyVideo(path.join(dir, 'final.mp4'), { snapshot: iteration === 1 });
    runs.push({ iteration, id, dir, passed: true, reports: reports.map(({ logs, ...rest }) => rest) });
    await writeFile(path.join(suiteDir, 'suite.json'), JSON.stringify({ environment: runtime.environment, requestedRuns: repeat, completedRuns: runs.length, cloudAccepted: false, runs }, null, 2));
  }
} finally {
  await writeFile(path.join(suiteDir, 'requests.json'), JSON.stringify(runtime.events, null, 2));
  await runtime.dispose();
  console.log(`Evidence: ${suiteDir}`);
}
