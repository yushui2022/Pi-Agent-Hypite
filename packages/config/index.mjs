import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export async function loadConfig(file) {
  if (!file) {
    file = process.env.APP_CONFIG;
    if (!file) { try { await access(path.join(projectRoot,'config.local.json')); file=path.join(projectRoot,'config.local.json'); } catch { file=path.join(projectRoot,'config.example.json'); } }
  }
  file=path.resolve(file);
  const raw=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
  const resolve=(value, fallback)=>path.resolve(path.dirname(file),value || fallback);
  return {
    ...raw,
    piCli: raw.piCli ? resolve(raw.piCli) : path.join(projectRoot,'vendor/pi/packages/coding-agent/dist/bundle/cli.js'),
    hypitRoot: raw.hypitRoot ? resolve(raw.hypitRoot) : path.join(projectRoot,'vendor/hypit'),
    skillPath: raw.skillPath ? resolve(raw.skillPath) : path.join(projectRoot,'vendor/hypit/skills/hypit/SKILL.md'),
    tempRoot: resolve(raw.tempRoot,'.cache'), dataRoot:resolve(raw.dataRoot,'.data/jobs'),
    piHome:resolve(raw.piHome,'.data/pi'),
    agent: { provider:'', model:'', timeoutMs:600000, ...raw.agent },
  };
}
