import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { output } from './paths.mjs';

export async function matrixFixtures() {
  const dir = path.join(output, 'matrix-inputs');
  await mkdir(dir, { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const run = args => execFileSync(ffmpeg, ['-v', 'error', '-y', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], { timeout: 120_000, windowsHide: true, stdio: 'pipe' });
  const cases = [
    { id: 'landscape-30', size: '1280x720', fps: 30, seconds: 5, audio: false, accepted: true },
    { id: 'portrait-1080', size: '1080x1920', fps: 30, seconds: 5, audio: false, accepted: true },
    { id: 'portrait-60-audio', size: '720x1280', fps: 60, seconds: 5, audio: true, accepted: true },
    { id: 'small-seek', size: '640x360', fps: 24, seconds: 8, startSeconds: 2, audio: true, accepted: true },
    { id: 'high-profile-bframes', size: '1080x1920', fps: 30, seconds: 5, preset: 'medium', accepted: true },
    { id: 'too-short', size: '320x240', fps: 25, seconds: 2, accepted: false, error: 'five-second' },
    { id: 'too-many-pixels', size: '2048x1152', fps: 25, seconds: 1, accepted: false, error: 'pixel budget' },
    { id: 'too-long', size: '160x120', fps: 25, seconds: 61, accepted: false, error: '60 seconds' },
    { id: 'non-h264', size: '320x240', fps: 25, seconds: 5, codec: 'mpeg4', accepted: false, error: 'H.264' },
    { id: 'ten-bit', size: '320x240', fps: 25, seconds: 5, pixelFormat: 'yuv420p10le', accepted: false, error: '8-bit' },
  ];
  for (const item of cases) {
    const file = path.join(dir, `${item.id}.mp4`);
    const args = ['-f', 'lavfi', '-i', `testsrc2=size=${item.size}:rate=${item.fps}:duration=${item.seconds}`];
    if (item.audio) args.push('-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=44100:duration=${item.seconds}`, '-c:a', 'aac');
    args.push('-c:v', item.codec || 'libx264', '-threads', '1', '-pix_fmt', item.pixelFormat || 'yuv420p');
    if (!item.codec) args.push('-preset', item.preset || 'ultrafast', '-crf', '32');
    args.push('-t', String(item.seconds), '-movflags', '+faststart', file);
    run(args);
  }
  run(['-display_rotation:v:0', '90', '-i', path.join(dir, 'landscape-30.mp4'), '-c', 'copy', path.join(dir, 'rotated.mp4')]);
  cases.push({ id: 'rotated', accepted: false, error: 'Rotated' });
  await writeFile(path.join(dir, 'corrupt.mp4'), Buffer.from('deliberately invalid synthetic MP4'));
  cases.push({ id: 'corrupt', accepted: false, error: 'Invalid or damaged' });
  for (const item of cases) {
    const bytes = await readFile(path.join(dir, `${item.id}.mp4`));
    item.bytes = bytes.length;
    item.sha256 = createHash('sha256').update(bytes).digest('hex');
    if (item.bytes > 8 * 1024 * 1024) throw new Error(`Fixture exceeds transport cap: ${item.id}`);
    if (item.id !== 'corrupt') {
      const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path.join(dir, `${item.id}.mp4`)], { windowsHide: true, timeout: 30_000 }));
      const video = probe.streams.find(s => s.codec_type === 'video');
      item.nativeMetadata = { codec: video.codec_name, profile: video.profile, width: video.width, height: video.height, pixelFormat: video.pix_fmt, bFrames: video.has_b_frames, rotation: video.side_data_list?.find(s => s.side_data_type === 'Display Matrix')?.rotation ?? 0 };
      if (item.id === 'rotated') assert.equal(Math.abs(item.nativeMetadata.rotation), 90, 'Rotation fixture was not actually rotated');
      if (item.id === 'high-profile-bframes') assert.ok(video.has_b_frames > 0 && video.profile === 'High', 'High-profile B-frame fixture missing');
      if (item.id === 'ten-bit') assert.equal(video.pix_fmt, 'yuv420p10le');
    }
  }
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ kind: 'synthetic-inputs-not-worker-outputs', cases }, null, 2));
  return { dir, cases };
}
