import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root, repo } from './paths.mjs';

const [seriesDir, matrixDir] = process.argv.slice(2).map(p => path.resolve(p));
if (!seriesDir || !matrixDir) throw new Error('Pass minimal-core 20-run directory and passing matrix directory');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const series = await json(path.join(seriesDir, 'suite.json'));
const provenance = await json(path.join(seriesDir, 'provenance.json'));
const matrix = await json(path.join(matrixDir, 'matrix.json'));
const matrixProvenance = await json(path.join(matrixDir, 'provenance.json'));
const baseline = await json(path.join(root, 'evidence/local-2026-10-19.json'));
assert.equal(series.completedRuns, 20);
assert.equal(series.requestedRuns, 20);
assert.equal(provenance.core.minimalBuild, true);
assert.equal(matrix.passed, true);
assert.equal(matrix.complete, true);
assert.equal(matrixProvenance.core.wasmSha256, provenance.core.wasmSha256);
assert.equal(matrixProvenance.workerSha256, provenance.workerSha256);
for (const run of series.runs) {
  assert.equal(run.passed, true);
  const check = await json(path.join(run.dir, 'verification.json'));
  assert.equal(check.frames, 375);
  assert.equal(check.captionChecks.length, 3);
}
const records = series.runs.flatMap(run => run.reports);
const repeatedFinals = records.filter(record => record.operation === 'final');
assert.equal(new Set(repeatedFinals.map(record => record.sha256)).size, 1);
const operations = ['concat', 'render-1', 'render-2', 'render-3', 'final'].map(operation => {
  const rows = records.filter(row => row.operation === operation);
  assert.equal(rows.length, 20);
  return { operation, runs: rows.length, wallMsMin: Math.min(...rows.map(r => r.elapsedMs)), wallMsMax: Math.max(...rows.map(r => r.elapsedMs)),
    wasmHeapMaxBytes: Math.max(...rows.map(r => r.heapFinal)), trackedBytesAtArchiveMax: Math.max(...rows.map(r => r.trackedBytesAtArchive)),
    cloudCpuMs: null, totalIsolatePeakBytes: null };
});
const archive = path.join(repo, 'output/workers-p0/2026-10-19-refinement');
await mkdir(archive, { recursive: true });
for (const name of ['final.mp4', 'frame-1s.png', 'verification.json', 'provenance.json', 'matrix.json', 'landscape-30.png', 'portrait-1080.png', 'portrait-60-audio.png', 'small-seek.png', 'high-profile-bframes.png']) await copyFile(path.join(matrixDir, name), path.join(archive, name));
const bytes = await readFile(path.join(archive, 'final.mp4'));
const baselineBytes = baseline.currentBuildProvenance.core.wasmBytes;
const summary = {
  date: '2026-10-19', status: 'minimal-core-and-input-matrix-locally-verified', cloudAccepted: false, productionReady: false, liveModelAccepted: false,
  repeatedRuns: 20, repeatedFinalSha256: repeatedFinals[0].sha256, inputCases: matrix.cases, captionAdmissionCases: matrix.captionAdmissionCases, core: provenance.core,
  wasmSize: { baselineBytes, minimalBytes: provenance.core.wasmBytes, reductionPercent: (1 - provenance.core.wasmBytes / baselineBytes) * 100 },
  operations, matrixCases: matrix.reports.map(({ logs, ...record }) => record),
  normalizedFinal: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, verification: matrix.verification },
  inputLimits: { videoBytes: 8 * 1024 * 1024, maxDimension: 1920, maxPixels: 1920 * 1080, maxDurationSeconds: 60, maxFps: 60, format: '8-bit H.264 MP4, no rotation metadata', caption: 'max 2 lines / 15 characters per line; actual glyph coverage checked' },
  seriesEvidence: seriesDir, matrixEvidence: matrixDir, archive,
  metricsNote: 'Known Wasm/MEMFS buffers only; not total isolate memory or Cloudflare CPU. Synthetic video and tones, not product-video quality or real speech.',
  remaining: ['Cloudflare rendering/20-run resource gate', 'Cloudflare Media Transformations', 'real model/voice and product quality', '100 MB upload and normalization', 'production cancellation/idempotency/tenant scheduling'],
};
await writeFile(path.join(root, 'evidence/refinement-2026-10-19.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ archive, wasmSize: summary.wasmSize, repeatedRuns: 20, inputCases: matrix.cases, cloudAccepted: false }, null, 2));
