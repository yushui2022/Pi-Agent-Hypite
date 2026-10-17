import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, createJob, showJob, inspectJob } from '../packages/jobs/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2);
  let configFile;
  if (args[0] === '--config') { args.shift(); configFile = args.shift(); }
  const [command, first, second] = args;
  if (!['create', 'show', 'check', 'plan'].includes(command) || !first || args.length !== (['check', 'plan'].includes(command) ? 3 : 2)) {
    throw new Error('Usage: npm run job -- [--config file] create brief.json | show <job-id> | check <job-id> <source> | plan <job-id> <run>');
  }
  const config = await loadConfig(configFile);
  const result = command === 'create'
    ? await createJob(config, JSON.parse((await readFile(first, 'utf8')).replace(/^\uFEFF/, '')))
    : command === 'show' ? await showJob(config, first)
      : await inspectJob(config, first, command, second);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
