import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { loadConfig } = await import('../packages/config/index.mjs');
const config = await loadConfig(process.argv[2]);
for (const key of ['piCli', 'hypitRoot', 'tempRoot']) {
  if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) throw new Error(`${key} must be an absolute path`);
}
const skill = config.skillPath;
await access(skill);
await mkdir(config.tempRoot, { recursive: true });
const work = await mkdtemp(path.join(config.tempRoot, 'doctor-'));
const env = {
  ...process.env, TEMP: work, TMP: work, TMPDIR: work,
  PI_CODING_AGENT_DIR: path.join(work, 'pi-home'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0',
};
const run = (cli, args) => execFileSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', cwd: work, env, timeout: 30000, windowsHide: true,
}).trim();
const report = {
  recordedAt: new Date().toISOString(), node: process.version,
  piCli: config.piCli,
  hypitSourceRoot: config.hypitRoot,
  piVersion: run(config.piCli, ['--version']),
  hypit: JSON.parse(run(path.join(config.hypitRoot, 'bin/hypit.mjs'), ['version', '--json'])),
  checks: [],
  scope: 'Startup and skill discovery only; no model prompt, build, render or paid request.',
};
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [config.piCli,
      '--mode', 'rpc', '--no-session', '--offline', '--no-extensions', '--no-mcp',
      '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-tools', '--skill', skill,
    ], { cwd: work, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', response, failure;
    const timer = setTimeout(() => {
      failure = new Error('Pi RPC timed out after 30 seconds');
      child.kill();
    }, 30000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', error => { failure = error; });
    child.stderr.resume(); // Do not persist potentially sensitive diagnostics.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { failure = new Error('RPC record too large'); child.kill(); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const record = JSON.parse(line);
          if (record.id === 'doctor-commands' && record.type === 'response') {
            response = record;
            child.stdin.end();
          }
        } catch { failure = new Error('Invalid JSON on Pi RPC stdout'); child.kill(); }
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0 || !response?.success) return reject(new Error('Pi RPC did not exit successfully with a command response'));
      resolve(response);
    });
    child.stdin.write(JSON.stringify({ id: 'doctor-commands', type: 'get_commands' }) + '\n');
  });
  const commands = result.data?.commands;
  const loaded = commands?.find(item => item.name === 'skill:hypit' && item.source === 'skill');
  if (!loaded) throw new Error('Hypit skill missing from Pi command registry');
  report.checks.push({ name: 'pi-rpc-hypit-skill', status: 'passed', command: loaded.name });
} catch (error) {
  report.checks.push({ name: 'pi-rpc-hypit-skill', status: 'failed', error: error.message });
  process.exitCode = 1;
}
const reportPath = path.join(work, 'report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
