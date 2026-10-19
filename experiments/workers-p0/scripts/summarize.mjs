import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, repo } from './paths.mjs';

const [suitePath, smokePath] = process.argv.slice(2).map(p => path.resolve(p));
if (!suitePath || !smokePath) throw new Error('Pass the 20-run suite directory and the current-build smoke directory');
const suite = JSON.parse(await readFile(path.join(suitePath, 'suite.json'), 'utf8'));
assert.equal(suite.completedRuns, 20);
assert.equal(suite.requestedRuns, 20);
const verified = [];
for (const run of suite.runs) {
  assert.equal(run.passed, true);
  const check = JSON.parse(await readFile(path.join(run.dir, 'verification.json'), 'utf8'));
  assert.equal(check.frames, 375);
  assert.equal(check.captionChecks.length, 3);
  verified.push(check);
}
const records = suite.runs.flatMap(run => run.reports);
const operations = ['concat', 'render-1', 'render-2', 'render-3', 'final'].map(operation => {
  const rows = records.filter(row => row.operation === operation);
  assert.equal(rows.length, 20);
  return { operation, runs: rows.length, wallMsMin: Math.min(...rows.map(r => r.elapsedMs)), wallMsMax: Math.max(...rows.map(r => r.elapsedMs)),
    wasmHeapMaxBytes: Math.max(...rows.map(r => r.heapFinal)), trackedBytesAtArchiveMax: Math.max(...rows.map(r => r.trackedBytesAtArchive)),
    cloudCpuMs: null, totalIsolatePeakBytes: null };
});
const provenance = JSON.parse(await readFile(path.join(smokePath, 'provenance.json'), 'utf8'));
const smokeVerification = JSON.parse(await readFile(path.join(smokePath, 'verification.json'), 'utf8'));
const bytes = await readFile(path.join(smokePath, 'final.mp4'));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const seriesHashes = [...new Set(records.filter(row => row.operation === 'final').map(r => r.sha256))];
assert.deepEqual(seriesHashes, [sha256], 'Current guarded build must reproduce the repeated-series output');
const archive = path.join(repo, 'output/workers-p0/2026-10-19');
await mkdir(archive, { recursive: true });
for (const [from, to] of [['final.mp4', 'p0-15s-720p.mp4'], ['frame-1s.png', 'frame-1s.png'], ['provenance.json', 'provenance.json'], ['verification.json', 'verification.json']]) await copyFile(path.join(smokePath, from), path.join(archive, to));
const summary = {
  date: '2026-10-19', status: 'local-experiment-passed-cloud-gate-pending', environment: 'Windows local workerd 1.20260730.1 via Miniflare 4.20260730.0',
  cloudAccepted: false, liveModelAccepted: false, minimalCoreBuildAccepted: false, productionReady: false,
  repeatedRuns: 20, output: { sha256, bytes: bytes.length, ...smokeVerification }, operations,
  currentBuildProvenance: provenance,
  seriesEvidence: suitePath, currentBuildEvidence: smokePath, archive,
  seriesProvenanceNote: 'Series used the same media kernel before the final JSON-body admission guard. Current-build smoke reproduces identical final MP4 SHA-256; source provenance captured automatically for the current build.',
  metricsNote: 'Wall time is not cloud CPU; tracked buffers exclude JS/code/R2 internals/transient copies. No measured total isolate peak. Synthetic dual-tone audio, not real speech sync.',
  remaining: ['real Cloudflare media transformations', 'cloud rendering and 20-run resource gate', 'minimal single-thread source build and full license manifest', 'real model validation', 'real speech and representative product-video quality'],
};
await mkdir(path.join(root, 'evidence'), { recursive: true });
await writeFile(path.join(root, 'evidence/local-2026-10-19.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ archive, sha256, repeatedRuns: 20, cloudAccepted: false }));
