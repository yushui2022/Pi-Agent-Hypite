import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyVideo(file, { snapshot = false } = {}) {
  const probe = process.env.FFPROBE_PATH || 'ffprobe';
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  // Limit both input decoding and output encoding (rawvideo/PNG also spawn
  // frame threads otherwise). Native validation shares the developer's machine.
  const run = (bin, args) => execFileSync(bin, bin === ffmpeg ? ['-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args.slice(0, -1), '-threads', '1', args.at(-1)] : args, { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const data = JSON.parse(run(probe, ['-v', 'error', '-show_streams', '-show_format', '-show_packets', '-of', 'json', file]));
  const video = data.streams.find(s => s.codec_type === 'video');
  const audio = data.streams.find(s => s.codec_type === 'audio');
  assert.equal(video?.codec_name, 'h264');
  assert.equal(audio?.codec_name, 'aac');
  assert.deepEqual([video.width, video.height, video.r_frame_rate], [720, 1280, '25/1']);
  assert.equal(Number(video.nb_frames), 375);
  assert.ok(Math.abs(Number(data.format.duration) - 15) <= 1 / 25, `duration ${data.format.duration}`);
  assert.ok(Math.abs(Number(video.start_time) - Number(audio.start_time)) <= 1 / 25, 'A/V start offset');
  for (const stream of data.streams) {
    const packets = data.packets.filter(p => p.stream_index === stream.index);
    for (let i = 1; i < packets.length; i++) assert.ok(Number(packets[i].dts) > Number(packets[i - 1].dts), `non-increasing DTS ${stream.codec_type}`);
    if (stream.codec_type === 'video') for (let i = 1; i < packets.length; i++) assert.ok(Math.abs(Number(packets[i].pts_time) - Number(packets[i - 1].pts_time) - 0.04) < 0.001, 'non-uniform video frame spacing');
  }
  run(ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
  const luma = run(ffmpeg, ['-v', 'error', '-i', file, '-an', '-vf', 'scale=16:28', '-fps_mode', 'passthrough', '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
  assert.equal(luma.length, 375 * 16 * 28);
  let minimumFrameLuma = 255;
  for (let offset = 0; offset < luma.length; offset += 16 * 28) {
    const average = luma.subarray(offset, offset + 16 * 28).reduce((sum, value) => sum + value, 0) / (16 * 28);
    minimumFrameLuma = Math.min(minimumFrameLuma, average);
    assert.ok(average > 10, 'unexpected black frame in synthetic fixture');
  }
  const pcm = run(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', '-']);
  const samples = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  function window(at, duration = 0.1) {
    const segment = samples.slice(Math.round(at * 48000), Math.round((at + duration) * 48000));
    const rms = Math.sqrt(segment.reduce((sum, v) => sum + v * v, 0) / segment.length);
    const amplitude = frequency => {
      let real = 0, imaginary = 0;
      for (let i = 0; i < segment.length; i++) { real += segment[i] * Math.cos(2 * Math.PI * frequency * i / 48000); imaginary += segment[i] * Math.sin(2 * Math.PI * frequency * i / 48000); }
      return 2 * Math.hypot(real, imaginary) / segment.length;
    };
    return { at, rms, voice440: amplitude(440), music880: amplitude(880) };
  }
  const audioWindows = [0, 1, 4.95, 5, 9.95, 10, 14.5, 14.9].map(at => window(at));
  const middle = audioWindows[1];
  assert.ok(middle.voice440 > 0.01 && middle.music880 > 0.003, 'both synthetic audio sources must be present');
  assert.ok(middle.voice440 / middle.music880 > 3 && middle.voice440 / middle.music880 < 5, 'expected volume ratio');
  for (const sample of audioWindows.slice(2, 6)) assert.ok(sample.rms > middle.rms * 0.8, 'audio gap at shot boundary');
  assert.ok(audioWindows[0].rms < middle.rms && audioWindows.at(-1).rms < middle.rms * 0.5, 'audio fade endpoints');
  // This synthetic background has no near-white text in the caption region.
  // Pixel evidence prevents a successful encoder exit from passing with missing subtitles.
  const captionChecks = [];
  for (const at of [1, 6, 11]) {
    const pixels = run(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', file, '-vf', 'crop=660:140:30:1050', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    let whitePixels = 0;
    for (let i = 0; i < pixels.length; i += 3) if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) whitePixels++;
    assert.ok(whitePixels > 700, `caption missing at ${at}s: ${whitePixels} white pixels`);
    captionChecks.push({ at, whitePixels });
  }
  const report = {
    file: path.basename(file), verifiedBy: 'native ffprobe/ffmpeg inspecting Worker output',
    duration: Number(data.format.duration), videoStart: Number(video.start_time), audioStart: Number(audio.start_time),
    frames: Number(video.nb_frames), width: video.width, height: video.height, fps: video.r_frame_rate,
    videoCodec: video.codec_name, audioCodec: audio.codec_name, decodeErrors: 0, monotonicDts: true, minimumFrameLuma, audioWindows, captionChecks,
    subtitleVisualReview: 'See frame-1s.png; numeric checks alone do not prove caption layout',
    realSpeechSyncAccepted: false, cloudAccepted: false,
  };
  if (snapshot) run(ffmpeg, ['-v', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', path.join(path.dirname(file), 'frame-1s.png')]);
  const execution = JSON.parse(await readFile(path.join(path.dirname(file), 'report.json'), 'utf8'));
  for (const step of execution.reports) assert.ok(!step.logs?.some(line => /Non-monotonous|not monotonically|Error opening|Glyph .*not found|Could not find font/.test(line)), `unexpected ${step.operation} diagnostics`);
  await writeFile(path.join(path.dirname(file), 'verification.json'), JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyVideo(path.resolve(process.argv[2]), { snapshot: true });
  console.log(JSON.stringify(report, null, 2));
}
