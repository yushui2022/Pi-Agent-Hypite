import { Miniflare, Log, LogLevel } from 'miniflare';
import path from 'node:path';
import { dist, output } from './paths.mjs';
export const localToken = 'p0-local-test-only-not-a-cloud-secret';
export function localRuntime(kind, persist = path.join(output, 'state'), extra = {}) {
  return new Miniflare({
    modules: true, scriptPath: path.join(dist, kind, 'worker.js'),
    modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
    compatibilityDate: '2026-07-30',
    bindings: { P0_TOKEN: localToken, P0_ENABLE_MEDIA: 'false' },
    r2Buckets: ['ARTIFACTS'], r2Persist: persist,
    log: new Log(LogLevel.WARN),
    ...extra,
  });
}
