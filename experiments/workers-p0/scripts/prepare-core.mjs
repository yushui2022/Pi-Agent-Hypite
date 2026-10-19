import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root, dist } from './paths.mjs';
import { wasmMemories } from './wasm-memory.mjs';

const choice = process.env.P0_CORE || (process.argv.includes('--core') ? process.argv[process.argv.indexOf('--core') + 1] : 'baseline');
if (!['baseline', 'minimal'].includes(choice)) throw new Error('core must be baseline or minimal');
const source = choice === 'minimal' ? (process.env.P0_CORE_SOURCE_DIR || 'G:/DevCache/Temp/pi-agent-hypite/workers-p0/source-build/release') : path.join(root, 'node_modules/@ffmpeg/core/dist/esm');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourceManifest = choice === 'minimal' ? JSON.parse(await readFile(path.join(source, 'build-manifest.json'), 'utf8')) : null;
await mkdir(dist, { recursive: true });
let js = await readFile(path.join(source, 'ffmpeg-core.js'), 'utf8');
const original = js;
const replacements = [
  ['scriptDirectory=self.location.href', 'scriptDirectory="https://p0.invalid/"'],
  ...(choice === 'baseline' ? [['function getHeapMax(){return 2147483648}', 'function getHeapMax(){return 100663296}']] : []),
];
for (const [before, after] of replacements) {
  if (js.split(before).length !== 2) throw new Error(`Core drift: expected exactly one ${before}`);
  js = js.replace(before, after);
}
const wasm = await readFile(path.join(source, 'ffmpeg-core.wasm'));
const declaredMemory = wasmMemories(wasm)[0];
if (declaredMemory.shared || choice === 'minimal' && (declaredMemory.maximumBytes !== 96 * 1024 * 1024 || declaredMemory.initialBytes !== 32 * 1024 * 1024)) throw new Error('Wasm binary memory declaration does not match the single-thread budget');
if (sourceManifest && (sourceManifest.wasmSha256 !== sha256(wasm) || sourceManifest.jsSha256 !== sha256(original) || sourceManifest.heapGrowthCapBytes !== 96 * 1024 * 1024)) throw new Error('Source-build artifact hash or memory cap mismatch');
await writeFile(path.join(dist, 'ffmpeg-core.js'), js);
await copyFile(path.join(source, 'ffmpeg-core.wasm'), path.join(dist, 'ffmpeg-core.wasm'));
await writeFile(path.join(dist, 'core-provenance.json'), JSON.stringify({
  package: choice === 'minimal' ? 'pi-studio-minimal-media-core' : '@ffmpeg/core', version: '0.12.10', license: 'GPL-2.0-or-later',
  sourceRepository: 'https://github.com/ffmpegwasm/ffmpeg.wasm',
  sourceRebuildVerified: choice === 'minimal', sourceManifest,
  upstreamJsSha256: sha256(original), adaptedJsSha256: sha256(js), wasmSha256: sha256(wasm),
  wasmBytes: wasm.length, heapGrowthCapBytes: 96 * 1024 * 1024, declaredMemory,
  patches: replacements, minimalBuild: choice === 'minimal',
}, null, 2));
console.log(`Prepared ${choice} single-thread core: ${wasm.length} bytes; 96 MiB heap growth cap (not total isolate memory).`);
