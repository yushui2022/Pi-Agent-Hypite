import { localRuntime, localToken } from './local-runtime.mjs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Same HTTP contract for local workerd and an explicitly supplied private test Worker.
// No provisioning, deployment, model call or automatic network retry occurs here.
export async function benchmarkDriver(remote) {
  let runtime;
  let base = 'https://p0.invalid/';
  let token = localToken;
  if (remote) {
    const url = new URL(remote);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Remote must be a bare HTTPS origin');
    base = url.href;
    token = process.env.P0_TOKEN;
    if (!token || token.length < 24) throw new Error('Set P0_TOKEN locally; never place secrets in command arguments');
  } else runtime = localRuntime('media');
  const events = [];
  const request = async (pathname, init = {}) => {
    const response = runtime ? await runtime.dispatchFetch(new URL(pathname, base), {
      ...init, headers: { ...init.headers, authorization: `Bearer ${token}` },
    }) : await fetch(new URL(pathname, base), { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` },
      redirect: 'manual', signal: AbortSignal.timeout(290_000) });
    events.push({ path: pathname, status: response.status, cfRay: response.headers.get('cf-ray'), at: new Date().toISOString() });
    if (response.status >= 300 && response.status < 400) throw new Error('Unexpected redirect; credentials were not forwarded');
    return response;
  };
  return {
    environment: remote ? 'cloudflare-remote-unaccepted' : 'local-workerd', events,
    async health() {
      const response = await request('/health');
      const data = await response.json();
      if (!response.ok || data.experiment !== 'workers-p0') throw new Error(`Unexpected benchmark target: HTTP ${response.status}`);
      return data;
    },
    async upload(name, bytes) {
      const response = await request(`/fixtures/${encodeURIComponent(name)}`, { method: 'PUT', body: bytes });
      const data = await response.json();
      if (!response.ok) throw new Error(`Fixture upload ${name}: ${JSON.stringify(data)}`);
      return data;
    },
    run: body => request('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    async download(id, name, file) {
      const response = await request(`/artifacts/${encodeURIComponent(id)}/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error(`Artifact download: HTTP ${response.status}`);
      if (!response.body) throw new Error('Artifact body missing');
      const reader = response.body.getReader();
      const handle = await open(file, 'w');
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 32 * 1024 * 1024) throw new Error('P0 artifact exceeds the download cap');
          hash.update(value);
          let offset = 0;
          while (offset < value.length) {
            const written = await handle.write(value, offset, value.length - offset);
            if (!written.bytesWritten) throw new Error('Artifact write made no progress');
            offset += written.bytesWritten;
          }
        }
        return { bytes, sha256: hash.digest('hex') };
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await handle.close(); }
    },
    async dispose() { await runtime?.dispose(); },
  };
}
