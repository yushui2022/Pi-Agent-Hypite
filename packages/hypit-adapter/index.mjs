import { spawn } from 'node:child_process';
import path from 'node:path';

// Only non-submitting commands are exposed in P0. Never retry a process here.
export async function inspectSource({ cli, workspace, source, operation, tempRoot, timeoutMs = 30000, maxBytes = 2 * 1024 * 1024 }) {
  if (!['check', 'plan'].includes(operation)) throw new Error('Only check and plan are supported');
  const args = [cli, operation, source, '--workspace', workspace, '--json'];
  const startedAt = new Date().toISOString();
  return new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, error = null;
    const child = spawn(process.execPath, args, {
      cwd: workspace, windowsHide: true, shell: false,
      env: { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { error = 'timeout'; child.kill(); }, timeoutMs);
    const collect = stream => chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) { error = 'output_limit'; child.kill(); return; }
      if (stream === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding('utf8').on('data', collect('stdout'));
    child.stderr.setEncoding('utf8').on('data', collect('stderr'));
    child.on('error', () => { error = 'process_start_failed'; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      let data = null;
      if (!error) {
        try { data = JSON.parse(stdout); } catch { error = 'invalid_json'; }
        if (data?.format === 'hypit.cli-error@1' && data.ok === false) error = 'hypit_error';
        else if (data && (data.format !== `hypit.cli-${operation}@1` || typeof data.ok !== 'boolean')) error = 'unsupported_response';
      }
      resolve({
        operation, source: path.relative(workspace, source), startedAt, finishedAt: new Date().toISOString(),
        ok: !error && exitCode === 0 && data?.ok === true,
        exitCode, signal, error, data, stdout, stderr,
      });
    });
  });
}
