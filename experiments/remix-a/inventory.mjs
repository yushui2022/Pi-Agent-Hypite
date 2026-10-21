// Read-only inventory of a Hypit project's execution plan.
// Answers one question with real data instead of estimates: how many model calls does
// one "clone with my person/product" actually cost, and which provider serves each one.
// Never submits a build. Only `check` and `plan` are invoked.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cli = path.join(root, 'vendor', 'hypit', 'bin', 'hypit.mjs');

function run(args) {
  return new Promise(resolve => {
    execFile(process.execPath, [cli, ...args], { cwd: root, maxBuffer: 128 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        let data = null;
        try { data = JSON.parse(stdout); } catch { /* reported by the caller */ }
        resolve({ data, raw: String(stdout ?? '').slice(0, 2000) });
      });
  });
}

// Heuristic only: the plan names a capability, not a price. Anything unclassified stays visible.
const KIND = [
  [/seedance|pixverse|wan|grok-imagine|minimax/i, 'video-generation'],
  [/gpt-image|seedream|nano-banana/i, 'image-generation'],
  [/speech|elevenlabs|fishaudio|mimo/i, 'speech'],
  [/whisperx|transcri|align/i, 'transcription'],
  [/render|hyperframes/i, 'render'],
];

export async function inventory({ project, source }) {
  const workspace = path.resolve(root, project);
  const target = path.join(workspace, source);
  const check = await run(['check', target, '--workspace', workspace, '--json']);
  if (!check.data?.ok) return { ok: false, stage: 'check', detail: check.data ?? check.raw };
  const plan = await run(['plan', target, '--workspace', workspace, '--json']);
  if (!plan.data?.ok) return { ok: false, stage: 'plan', detail: plan.data ?? plan.raw };

  const arrays = Object.entries(plan.data).filter(([, value]) => Array.isArray(value));
  const requests = arrays.find(([, value]) => value.some(entry => entry && typeof entry === 'object' && 'capability' in entry))?.[1] ?? [];
  const calls = new Map();
  for (const entry of requests) {
    const capability = String(entry.capability ?? entry.service ?? 'unlabelled');
    const kind = KIND.find(([pattern]) => pattern.test(capability))?.[1] ?? 'other';
    const key = `${kind} :: ${capability}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
  }
  return {
    ok: true,
    project: path.relative(root, workspace).replace(/\\/g, '/'),
    source,
    check: check.data,
    planArrays: arrays.map(([key, value]) => `${key}(${value.length})`),
    totalSteps: requests.length,
    calls: [...calls.entries()].map(([key, count]) => ({ capability: key, count })).sort((a, b) => b.count - a.count || a.capability.localeCompare(b.capability)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [project, source] = process.argv.slice(2);
  if (!project || !source) {
    console.error('usage: node experiments/remix-a/inventory.mjs <project-dir> <run.svrun>');
    process.exitCode = 2;
  } else {
    const result = await inventory({ project, source });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
