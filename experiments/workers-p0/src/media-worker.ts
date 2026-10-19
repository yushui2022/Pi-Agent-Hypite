import { createCore } from './media-core';
import { authorize, bodyJson, boundedBytes, failure, hash, json, Problem, runId } from './shared';
import { captionText, clipStart } from './media-policy';
import coreBuild from '../dist/core-provenance.json';

interface Env { P0_TOKEN: string; P0_ENABLE_MEDIA?: string; ARTIFACTS: R2Bucket; MEDIA?: any }
const fixtureNames = ['shot-1.mp4', 'shot-2.mp4', 'shot-3.mp4', 'voice.wav', 'music.wav', 'font.ttf'];
const outputNames = ['concat.mp4', 'render-1.mp4', 'render-2.mp4', 'render-3.mp4', 'final.mp4', 'frame.jpg', 'audio.m4a', 'transform.mp4'];
// Local admission only. Cloud benchmark driver must run sequentially; this is not a global scheduler.
let busy = false;

async function input(env: Env, name: string, runtime: Awaited<ReturnType<typeof createCore>>) {
  const object = await env.ARTIFACTS.get(name);
  if (!object) throw new Problem(409, `Missing input ${name}`);
  if (object.size > 8 * 1024 * 1024) throw new Problem(413, 'Fixture exceeds 8 MiB');
  // R2 supplies a verified size: allocate once instead of retaining every chunk
  // and then allocating a second whole-file buffer (especially costly for fonts).
  const bytes = new Uint8Array(object.size);
  const reader = object.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > bytes.length) { await reader.cancel(); throw new Problem(409, 'R2 input size changed'); }
      bytes.set(value, offset);
      offset += value.length;
    }
  } finally { reader.releaseLock(); }
  if (offset !== bytes.length) throw new Problem(409, 'Truncated R2 input');
  const local = name.split('/').at(-1)!;
  // canOwn avoids a second MEMFS copy of the input buffer.
  runtime.core.FS.writeFile(`/${local}`, bytes, { canOwn: true });
  return { local, size: bytes.byteLength };
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      authorize(request, env);
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return json({ experiment: 'workers-p0', cloudGate: 'not-accepted', mediaTransformationsEnabled: env.P0_ENABLE_MEDIA === 'true', core: { wasmSha256: coreBuild.wasmSha256, minimalBuild: coreBuild.minimalBuild, sourceRebuildVerified: coreBuild.sourceRebuildVerified } });
      if (path.startsWith('/fixtures/') && request.method === 'PUT') {
        const name = path.slice('/fixtures/'.length);
        if (!fixtureNames.includes(name) || !request.body) throw new Problem(400, 'Unknown fixture');
        const bytes = await boundedBytes(request.body, 8 * 1024 * 1024);
        await env.ARTIFACTS.put(`fixtures/${name}`, bytes);
        return json({ name, bytes: bytes.length, sha256: await hash(bytes) });
      }
      if (path.startsWith('/artifacts/') && request.method === 'GET') {
        const [id, name, extra] = path.slice('/artifacts/'.length).split('/');
        runId(id);
        if (extra || !outputNames.includes(name)) throw new Problem(400, 'Unknown artifact');
        const object = await env.ARTIFACTS.get(`runs/${id}/${name}`);
        if (!object) throw new Problem(404, 'Artifact not found');
        return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'video/mp4', 'Cache-Control': 'no-store' } });
      }
      if (path !== '/run' || request.method !== 'POST') throw new Problem(404, 'Unknown experiment route');
      const { id: rawId, operation, caption, startSeconds } = await bodyJson(request);
      const id = runId(rawId);
      if (!['version', 'inspect', 'normalize-1', 'normalize-2', 'normalize-3', 'concat', 'render-1', 'render-2', 'render-3', 'final', 'frame', 'audio', 'transform'].includes(operation)) throw new Problem(400, 'Unknown operation');
      const normalize = operation.startsWith('normalize-');
      const text = normalize ? captionText(caption) : null;
      const seek = normalize ? clipStart(startSeconds) : 0;
      if (busy) throw new Problem(429, 'One local experiment step at a time');
      busy = true;
      const start = Date.now();
      try {
        if (['frame', 'audio', 'transform'].includes(operation)) {
          if (env.P0_ENABLE_MEDIA !== 'true' || !env.MEDIA) throw new Problem(503, 'Cloud Media Transformations disabled until account and budget are configured');
          const source = await env.ARTIFACTS.get('fixtures/shot-1.mp4');
          if (!source) throw new Problem(409, 'Missing fixture');
          let pipe = env.MEDIA.input(source.body);
          if (operation !== 'audio') pipe = pipe.transform({ width: 360, height: 640, fit: 'cover' });
          const options = operation === 'frame' ? { mode: 'frame', time: '1s' } : { mode: operation === 'audio' ? 'audio' : 'video', time: '1s', duration: '3s' };
          const result = pipe.output(options);
          const name = operation === 'frame' ? 'frame.jpg' : operation === 'audio' ? 'audio.m4a' : 'transform.mp4';
          const contentType = await result.contentType();
          await env.ARTIFACTS.put(`runs/${id}/${name}`, await result.media(), { httpMetadata: { contentType } });
          const report = { id, operation, name, elapsedMs: Date.now() - start, kind: 'cloud-media', cost: null };
          await env.ARTIFACTS.put(`runs/${id}/${operation}.json`, JSON.stringify(report));
          return json(report);
        }
        const runtime = await createCore();
        const heapInitial = runtime.heapBytes();
        if (operation === 'version') {
          runtime.exec(['-version']);
          return json({ operation, heapInitial, heapFinal: runtime.heapBytes(), logs: runtime.logs, kind: 'wasm', cpuMs: null, totalIsolatePeakBytes: null });
        }
        let inputBytes = 0;
        const load = async (key: string) => { const value = await input(env, key, runtime); inputBytes += value.size; return value.local; };
        const name = `${normalize ? operation.replace('normalize-', 'render-') : operation}.mp4`;
        let inputMetadata: ReturnType<typeof runtime.probe> | null = null;
        let args: string[];
        if (normalize || operation === 'inspect') {
          const number = normalize ? Number(operation.slice(-1)) : 1;
          const local = await load(`fixtures/shot-${number}.mp4`);
          try { inputMetadata = runtime.probe(`/${local}`); }
          catch (error) { throw new Problem(422, error instanceof Error ? error.message : 'Unsupported video input'); }
          if (operation === 'inspect') return json({ id, operation, inputMetadata, heapInitial, heapFinal: runtime.heapBytes(), cloudAccepted: false });
          if (inputMetadata.duration + 0.001 < seek + 5) throw new Problem(422, 'Input does not contain the requested five-second clip');
          await load('fixtures/font.ttf');
          runtime.core.FS.writeFile('/captions.txt', text!);
          try { runtime.checkCaption('/font.ttf', text!); }
          catch (error) { throw new Problem(422, error instanceof Error ? error.message : 'Unsupported caption'); }
          args = ['-threads', '1', '-ss', String(seek), '-i', `/${local}`, '-an', '-sn', '-dn', '-map', '0:v:0',
            '-filter_threads', '1', '-vf',
            'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,drawtext=fontfile=/font.ttf:textfile=/captions.txt:expansion=none:fontsize=42:fontcolor=white:borderw=2:bordercolor=black:line_spacing=10:x=(w-text_w)/2:y=h-text_h-100',
            '-t', '5', '-frames:v', '125', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-threads', '1', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', '/output.mp4'];
        } else if (operation === 'concat' || operation === 'final') {
          const names = [];
          for (let i = 1; i <= 3; i++) names.push(await load(operation === 'concat' ? `fixtures/shot-${i}.mp4` : `runs/${id}/render-${i}.mp4`));
          runtime.core.FS.writeFile('/list.txt', names.map(n => `file '/${n}'`).join('\n'));
          // Video remux only: concatenating independently encoded AAC introduces encoder-delay discontinuities.
          args = ['-f', 'concat', '-safe', '0', '-i', '/list.txt'];
          if (operation === 'final') {
            await load('fixtures/voice.wav');
            await load('fixtures/music.wav');
            args.push('-i', '/voice.wav', '-i', '/music.wav', '-filter_complex_threads', '1', '-filter_complex',
              '[1:a]volume=0.8,afade=t=in:d=0.15,afade=t=out:st=14.7:d=0.3[a1];[2:a]volume=0.2,afade=t=in:d=0.15,afade=t=out:st=14.7:d=0.3[a2];[a1][a2]amix=inputs=2:duration=shortest:normalize=0[a]',
              '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '96k', '-t', '15');
          } else args.push('-map', '0:v:0', '-an', '-c:v', 'copy');
          args.push('-movflags', '+faststart', '/output.mp4');
        } else {
          const number = Number(operation.slice(-1));
          await load(`fixtures/shot-${number}.mp4`);
          await load('fixtures/voice.wav');
          await load('fixtures/music.wav');
          await load('fixtures/font.ttf');
          runtime.core.FS.mkdir('/fonts');
          runtime.core.FS.rename('/font.ttf', '/fonts/font.ttf');
          runtime.core.FS.writeFile('/captions.txt', 'Pi Studio P0 字幕已烧录进视频\n本地技术验证 非生成成品');
          args = ['-threads', '1', '-i', `/shot-${number}.mp4`, '-i', '/voice.wav', '-i', '/music.wav',
            '-filter_complex_threads', '1', '-filter_complex',
            '[0:v]drawtext=fontfile=/fonts/font.ttf:textfile=/captions.txt:fontsize=42:fontcolor=white:borderw=2:bordercolor=black:line_spacing=10:x=(w-text_w)/2:y=h-text_h-100[v];[1:a]volume=0.8,afade=t=in:d=0.15,afade=t=out:st=4.7:d=0.3[a1];[2:a]volume=0.2,afade=t=in:d=0.15,afade=t=out:st=4.7:d=0.3[a2];[a1][a2]amix=inputs=2:duration=shortest:normalize=0[a]',
            '-map', '[v]', '-map', '[a]', '-t', '5', '-r', '25', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
            '-threads', '1', '-pix_fmt', 'yuv420p', '-crf', '28', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '96k', '-movflags', '+faststart', '/output.mp4'];
        }
        try { runtime.exec(args); }
        catch (error) {
          const report = { id, operation, error: error instanceof Error ? error.message : 'Encoding failed', phase: 'encoding',
            heapInitial, heapFinal: runtime.heapBytes(), inputBytes, inputMetadata, logs: runtime.logs, cloudAccepted: false };
          await env.ARTIFACTS.put(`runs/${id}/${operation}-failure.json`, JSON.stringify(report));
          return json(report, 500);
        }
        const bytes: Uint8Array = runtime.core.FS.readFile('/output.mp4');
        const outputMemfsCapacityBytes = runtime.core.FS.lookupPath('/output.mp4').node.contents.byteLength;
        const sha256 = await hash(bytes);
        await env.ARTIFACTS.put(`runs/${id}/${name}`, bytes, { httpMetadata: { contentType: 'video/mp4' } });
        const report = {
          id, operation, name, sha256, outputBytes: bytes.byteLength, inputBytes,
          inputMetadata, caption: text, startSeconds: seek,
          heapInitial, heapFinal: runtime.heapBytes(), heapGrowthCapBytes: 96 * 1024 * 1024,
          outputMemfsCapacityBytes, archiveCopyBytes: bytes.byteLength,
          trackedBytesAtArchive: runtime.heapBytes() + inputBytes + outputMemfsCapacityBytes + bytes.byteLength,
          elapsedMs: Date.now() - start, cpuMs: null, totalIsolatePeakBytes: null, cost: null,
          measurementNote: 'Wasm heap + known MEMFS inputs/output capacity + archive copy. Excludes JS heap, library code, R2 internals and transient reads; NOT total isolate peak or cloud CPU',
          logs: runtime.logs, kind: 'wasm',
        };
        await env.ARTIFACTS.put(`runs/${id}/${operation}.json`, JSON.stringify(report));
        return json(report);
      } finally { busy = false; }
    } catch (error) { return failure(error); }
  },
};
