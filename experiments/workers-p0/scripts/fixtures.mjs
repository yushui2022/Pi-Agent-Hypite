import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { output } from './paths.mjs';
const dir = path.join(output, 'fixtures');
await mkdir(dir, { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const run = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], { stdio: 'inherit', timeout: 120_000, windowsHide: true });
for (let i = 1; i <= 3; i++) {
  run(['-f', 'lavfi', '-i', `testsrc2=size=720x1280:rate=25:duration=5`, '-f', 'lavfi', '-i', `sine=frequency=${180 * i}:sample_rate=48000:duration=5`,
    '-vf', `hue=h=${i * 70}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '96k', '-t', '5', '-movflags', '+faststart', path.join(dir, `shot-${i}.mp4`)]);
}
for (const [name, frequency] of [['voice', 440], ['music', 880]]) {
  run(['-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=15`, '-c:a', 'pcm_s16le', '-ac', '2', path.join(dir, `${name}.wav`)]);
}
// OFL licensed CJK subset prepared by font.mjs. No operating-system font redistribution.
const font = process.env.P0_FONT_PATH || path.join(output, 'font-source/p0-subset.ttf');
await copyFile(font, path.join(dir, 'font.ttf'));
const files = [];
for (const name of ['shot-1.mp4', 'shot-2.mp4', 'shot-3.mp4', 'voice.wav', 'music.wav', 'font.ttf']) {
  const bytes = await readFile(path.join(dir, name));
  files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ kind: 'synthetic-input-only', generator: execFileSync(ffmpeg, ['-version'], { encoding: 'utf8', windowsHide: true }).split('\n')[0], font, files }, null, 2));
console.log(`Generated synthetic inputs at ${dir}; not Worker outputs or real speech.`);
