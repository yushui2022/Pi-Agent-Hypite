import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { output } from './paths.mjs';
const dir = path.join(output, 'font-source');
await mkdir(dir, { recursive: true });
const sources = [
  ['NotoSansSC.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf', 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'],
  ['OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt', '1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9'],
];
const provenance = [];
for (const [name, url, expected] of sources) {
  let bytes;
  try { bytes = await readFile(path.join(dir, name)); }
  catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Font fetch failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Font exceeds download limit');
    await writeFile(path.join(dir, name), bytes);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected) throw new Error(`Upstream font changed: ${name}; review and pin before use`);
  provenance.push({ name, url, bytes: bytes.length, sha256 });
}
const text = 'Pi Studio P0 字幕已烧录进视频 本地技术验证 非生成成品';
await writeFile(path.join(dir, 'glyphs.txt'), text);
// Resolve the variable weight before FreeType. The subset is fixed-caption-only.
execFileSync(process.env.PYTHON_PATH || 'python', ['-m', 'fontTools.varLib.instancer', path.join(dir, 'NotoSansSC.ttf'), 'wght=400', '-o', path.join(dir, 'regular.ttf')],
{ stdio: 'pipe', windowsHide: true, timeout: 120_000 });
execFileSync(process.env.PYTHON_PATH || 'python', ['-m', 'fontTools.subset', path.join(dir, 'regular.ttf'),
  `--text-file=${path.join(dir, 'glyphs.txt')}`, `--output-file=${path.join(dir, 'p0-subset.ttf')}`, '--name-IDs=*', '--name-legacy', '--name-languages=*'],
{ stdio: 'inherit', windowsHide: true, timeout: 120_000 });
await writeFile(path.join(dir, 'provenance.json'), JSON.stringify({ license: 'OFL-1.1', sources: provenance, fixedCaptionOnly: true, text }, null, 2));
// A separate font for dynamic-caption experiments; the original benchmark stays fixed.
execFileSync(process.env.PYTHON_PATH || 'python', ['-m', 'fontTools.subset', path.join(dir, 'regular.ttf'),
  '--unicodes=U+0020-007E,U+00A0-00FF,U+2000-206F,U+3000-303F,U+4E00-9FFF,U+FF00-FFEF',
  `--output-file=${path.join(dir, 'cjk-common.ttf')}`, '--name-IDs=*', '--name-legacy', '--name-languages=*'],
{ stdio: 'inherit', windowsHide: true, timeout: 120_000 });
const common = await readFile(path.join(dir, 'cjk-common.ttf'));
await writeFile(path.join(dir, 'common-provenance.json'), JSON.stringify({ license: 'OFL-1.1', sources: provenance,
  bytes: common.length, sha256: createHash('sha256').update(common).digest('hex'),
  coverage: 'Basic Latin, Latin-1, punctuation, CJK Unified Ideographs, fullwidth forms. Actual glyph presence checked in Worker; not all Unicode.',
}, null, 2));
console.log(`Licensed fixed-caption font: ${path.join(dir, 'p0-subset.ttf')}`);
