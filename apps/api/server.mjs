import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAgentManager } from '../../workers/agent/manager.mjs';
import { loadConfig, listJobs, createJob, showJob, updateBrief, inspectJob } from '../../packages/jobs/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function createApp(config) {
  const agent = createAgentManager(config);
  let writes = Promise.resolve();
  const active = new Set();
  const serialize = fn => { const task = writes.then(fn); writes = task.catch(() => {}); return task; };
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const expectedHost = `127.0.0.1:${res.socket.localPort}`;
      if (req.headers.host !== expectedHost) return send(403, { error: '仅允许本地地址访问' });
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: '拒绝跨站请求' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      const url = new URL(req.url, `http://${expectedHost}`);
      const route = url.pathname;
      if (req.method === 'GET' && ['/','/app.js','/agent.js','/api.js','/ui.js','/workspace-state.js','/style.css'].includes(route)) {
        const file = route === '/' ? 'index.html' : route.slice(1);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        return res.end(await readFile(path.join(root, 'apps/web', file)));
      }
      if (req.method === 'GET' && route === '/api/services') return send(200, { mode: 'local', generation: false, agent: await agent.status(), message: 'Pi 会话与 Hypit 检查已接入。配置模型后可准备工程；视频生成服务尚未接通。' });
      if (req.method === 'GET' && route === '/api/jobs') return send(200, await listJobs(config));
      const match = route.match(/^\/api\/jobs\/(job_[a-f0-9-]{36})(?:\/(brief|duplicate|inspect|agent-runs|agent-stop))?$/);
      if (req.method === 'GET' && match?.[2] === 'agent-runs') return send(200, await agent.runs(match[1]));
      if (req.method === 'GET' && match && !match[2]) return send(200, await showJob(config, match[1]));
      if (!['POST', 'PUT'].includes(req.method)) return send(404, { error: '接口不存在' });
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: '需要 JSON 请求' });
      let raw = '';
      req.setEncoding('utf8');
      for await (const chunk of req) { raw += chunk.toString('utf8'); if (Buffer.byteLength(raw) > 65536) return send(413, { error: '需求内容过长' }); }
      let body; try { body = JSON.parse(raw); } catch { return send(400, { error: 'JSON 格式错误' }); }
      if (req.method === 'POST' && route === '/api/jobs') return send(201, await serialize(() => createJob(config, body)));
      if (req.method === 'POST' && match?.[2] === 'agent-runs') return send(202, await agent.start(match[1], body));
      if (req.method === 'POST' && match?.[2] === 'agent-stop') return send(202, await agent.stop(match[1]));
      if (match && req.method === 'PUT' && match[2] === 'brief') return send(200, await serialize(() => updateBrief(config, match[1], body.brief, body.revision)));
      if (match && req.method === 'POST' && match[2] === 'duplicate') {
        const job = await showJob(config, match[1]);
        return send(201, await serialize(() => createJob(config, { ...job.brief, title: `${job.title} · 变体` })));
      }
      if (match && req.method === 'POST' && match[2] === 'inspect') {
        const id = match[1];
        if (active.has(id)) return send(409, { error: '此任务正在检查，请稍后再试' });
        active.add(id);
        try { return send(200, await inspectJob(config, id, body.operation, body.source)); }
        finally { active.delete(id); }
      }
      send(404, { error: '接口不存在' });
    } catch (error) { send(error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.code === 'ENOENT' ? '文件或任务不存在，请先准备工程文件' : error.message }); }
  });
  server.agent = agent;
  server.on('close', () => { agent.shutdown().catch(console.error); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await loadConfig();
  const port = Number(process.env.PORT || 4317);
  const server = createApp(config);
  server.listen(port, '127.0.0.1', () => console.log(`Pi × Hypit 工作台：http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.agent.shutdown(); server.close(); });
}
