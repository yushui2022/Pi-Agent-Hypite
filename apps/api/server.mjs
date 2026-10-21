import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApplication } from '../../packages/application/index.mjs';
import { loadConfig } from '../../packages/config/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function createApp(config) {
  const application = createApplication(config);
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const expectedHost = `127.0.0.1:${res.socket.localPort}`;
      if (req.headers.host !== expectedHost) return send(403, { error: '仅允许本地地址访问' });
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: '拒绝跨站请求' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; media-src 'self' http://127.0.0.1:*; img-src 'self' http://127.0.0.1:*; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      const url = new URL(req.url, `http://${expectedHost}`);
      const route = url.pathname;
      if (req.method === 'GET' && ['/','/app.js','/agent.js','/api.js','/ui.js','/workspace-state.js','/style.css','/bulk.js','/bulk-format.js','/accounts.js','/accounts-model.js','/remix.js','/remix-preparation.js','/remix-batch-editor.js'].includes(route)) {
        const file = route === '/' ? 'index.html' : route.slice(1);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        return res.end(await readFile(path.join(root, 'apps/web', file)));
      }
      if (req.method === 'GET') { const result=await application.request({route,method:'GET'}); return send(result.status,result.data); }
      if (!['POST','PUT'].includes(req.method)) return send(404,{error:'接口不存在'});
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: '需要 JSON 请求' });
      let raw = '';
      req.setEncoding('utf8');
      for await (const chunk of req) { raw += chunk.toString('utf8'); if (Buffer.byteLength(raw) > 65536) return send(413, { error: '需求内容过长' }); }
      let body; try { body = JSON.parse(raw); } catch { return send(400, { error: 'JSON 格式错误' }); }
      const result=await application.request({route,method:req.method,body});
      send(result.status,result.data);
    } catch (error) { send(error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.code === 'ENOENT' ? '文件或任务不存在，请先准备工程文件' : error.message }); }
  });
  server.agent = application.agent;
  server.shutdown = () => application.shutdown();
  server.on('close', () => { application.shutdown().catch(console.error); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await loadConfig();
  const port = Number(process.env.PORT || 4317);
  const server = createApp(config);
  server.listen(port, '127.0.0.1', () => console.log(`Pi × Hypit 工作台：http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.shutdown(); server.close(); });
}
