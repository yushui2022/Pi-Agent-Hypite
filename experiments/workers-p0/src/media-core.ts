import createFFmpegCore from '../dist/ffmpeg-core.js';
import wasmModule from '../dist/ffmpeg-core.wasm';

// A new instance per experiment step avoids retaining failed encoder state.
// Only the compiled module is shared; mutable heaps/files are never shared.
export async function createCore() {
  const logs: string[] = [];
  let memory: WebAssembly.Memory;
  const core = await createFFmpegCore({
    instantiateWasm(imports: WebAssembly.Imports, receive: Function) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      memory = Object.values(instance.exports).find(e => e instanceof WebAssembly.Memory) as WebAssembly.Memory;
      if (!memory || memory.buffer.byteLength > 96 * 1024 * 1024) throw new Error('Initial Wasm memory exceeds budget');
      receive(instance, wasmModule);
      return instance.exports;
    },
  });
  core.setLogger(({ message }: { message: string }) => {
    logs.push(message.slice(0, 2000));
    if (logs.length > 120) logs.shift();
  });
  return {
    core, logs,
    heapBytes: () => memory!.buffer.byteLength,
    checkCaption(font: string, text: string) {
      if (typeof core._p0_caption !== 'function') throw new Error('Font validation requires the minimal core');
      const pointer = core.stringToPtr(font);
      const textPointer = core.stringToPtr(text);
      try {
        const missing = core._p0_caption(pointer, textPointer);
        if (missing < 0) throw new Error('Cannot inspect font');
        if (missing > 0) throw new Error(`Font does not contain U+${missing.toString(16).toUpperCase()}`);
      } finally { core._free(pointer); core._free(textPointer); }
    },
    probe(file: string) {
      if (typeof core._p0_probe !== 'function') throw new Error('Input inspection requires the minimal source-built core');
      const pointer = core.stringToPtr(file);
      const offset = logs.length;
      try {
        const code = core._p0_probe(pointer);
        const probeLogs = logs.slice(offset);
        if (code !== 0) throw new Error(probeLogs.find(line => line.startsWith('P0_PROBE_ERROR:'))?.slice(15) || 'Cannot inspect input');
        const data = probeLogs.find(line => line.startsWith('P0_PROBE:'));
        if (!data) throw new Error('Missing media metadata');
        return JSON.parse(data.slice(9)) as { codec: string; width: number; height: number; duration: number; fps: number; audioStreams: number; pixelFormat: string };
      } finally { core._free(pointer); }
    },
    exec(args: string[]) {
      core.reset();
      core.setTimeout(240_000);
      const code = core.exec(...args);
      if (code !== 0) throw new Error(`FFmpeg exit ${code}: ${logs.slice(-8).join('\n')}`);
      return code;
    },
  };
}
