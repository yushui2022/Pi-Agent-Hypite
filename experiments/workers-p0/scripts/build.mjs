import { build } from 'esbuild';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { root, repo, dist } from './paths.mjs';
await import('./prepare-core.mjs');
await mkdir(dist, { recursive: true });
for (const name of ['media', 'agent']) {
  await mkdir(path.join(dist, name), { recursive: true });
  if (name === 'media') await copyFile(path.join(dist, 'ffmpeg-core.wasm'), path.join(dist, 'media/ffmpeg-core.wasm'));
  const result = await build({
    entryPoints: [path.join(root, `src/${name}-worker.ts`)],
    outfile: path.join(dist, name, 'worker.js'),
    platform: 'browser', target: 'es2022', format: 'esm', bundle: true,
    plugins: [{ name: 'precompiled-wasm', setup(builder) {
      builder.onResolve({ filter: /ffmpeg-core\.wasm$/ }, () => ({ path: './ffmpeg-core.wasm', external: true }));
    } }], metafile: true,
    alias: {
      '@pi/agent': path.join(repo, 'vendor/pi/packages/agent/src/index.ts'),
      '@earendil-works/pi-ai': path.join(repo, 'vendor/pi/packages/ai/src/index.ts'),
      'typebox': path.join(repo, 'vendor/pi/node_modules/typebox/build/index.mjs'),
      'typebox/system': path.join(repo, 'vendor/pi/node_modules/typebox/build/system/index.mjs'),
      'typebox/compile': path.join(repo, 'vendor/pi/node_modules/typebox/build/compile/index.mjs'),
      'typebox/value': path.join(repo, 'vendor/pi/node_modules/typebox/build/value/index.mjs'),
    },
    legalComments: 'linked',
  });
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some(p => /vendor[\\/]hypit/.test(p))) throw new Error('Hypit runtime is prohibited in this experiment');
  await writeFile(path.join(dist, `${name}-metafile.json`), JSON.stringify(result.metafile, null, 2));
  console.log(`${name}: ${inputs.length} build inputs; no Hypit runtime`);
}
