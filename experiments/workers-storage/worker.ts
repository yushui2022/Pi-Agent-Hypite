// LOCAL TEST HARNESS ONLY. These fixture identities are not production authentication.
import { createRemixService } from '../../packages/remix/service.mjs';
import { createD1Repository } from '../../packages/cloudflare-storage/d1';
import { createR2Media } from '../../packages/cloudflare-storage/r2';
import { fault } from '../../packages/remix/revision.mjs';

interface Env { DB: D1Database; MEDIA: R2Bucket; LOCAL_STORAGE_TEST_ONLY?: string }
const identities: Record<string, string> = {
  'local-test-a': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'local-test-b': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.LOCAL_STORAGE_TEST_ONLY !== 'true') return new Response(null, { status: 503 });
    try {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
      const workspaceId = token && Object.hasOwn(identities, token) && identities[token];
      if (!workspaceId) throw fault('请先登录', 401);
      const repository = createD1Repository(env.DB, workspaceId), media = createR2Media(env.MEDIA, workspaceId);
      const service = createRemixService({ repository, media });
      const url = new URL(request.url), method = request.method;
      const respond = (value: unknown) => Response.json(value);
      if (url.pathname === '/api/remix' && method === 'GET') return respond(await service.list());
      if (url.pathname === '/api/remix' && method === 'POST') return respond(await service.create(await request.json()));
      const match = /^\/api\/remix\/(remix_[a-f0-9-]{36})(?:\/(plan|batches|check|execute))?$/.exec(url.pathname);
      if (match) {
        const [, id, action] = match;
        if (method === 'GET' && !action) return respond(await service.show(id));
        if (method === 'POST') {
          await service.read(id);
          if (action === 'execute') throw fault('云端制作尚未验收', 409);
          const input = await request.json();
          if (action === 'plan') return respond(await service.savePlan(id, input));
          if (action === 'batches') return respond(await service.makeBatch(id, input));
          if (action === 'check') return respond(await service.check(id, input));
        }
      }
      const preview = /^\/api\/media\/(remix_[a-f0-9-]{36})\/(asset_[a-f0-9-]{36})$/.exec(url.pathname);
      if (preview) return await media.respond(preview[1], await service.asset(preview[1], preview[2]), request);
      const fixture = /^\/test\/fixtures\/(remix_[a-f0-9-]{36})\/asset$/.exec(url.pathname);
      if (fixture && method === 'POST') {
        await service.read(fixture[1]);
        // Deliberately tiny synthetic fixture ingestion, not the future R2 direct-upload API.
        if (Number(request.headers.get('Content-Length')) > 4096) throw fault('测试素材过大', 413);
        const bytes = await request.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > 4096) throw fault('测试素材过大', 413);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const entry = {
          id: 'asset_' + crypto.randomUUID(), name: 'synthetic.mp4', mime: 'video/mp4',
          size: bytes.byteLength, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''),
          createdAt: new Date().toISOString(),
        };
        const key = media.key(fixture[1], entry);
        await env.MEDIA.put(key, bytes, { sha256: digest, httpMetadata: { contentType: entry.mime } });
        const result = await service.registerAsset(fixture[1], entry);
        if (result.assetId !== entry.id) await env.MEDIA.delete(key);
        return respond(result);
      }
      throw fault('接口不存在', 404);
    } catch (error) {
      const e = error as { status?: number; message?: string };
      return Response.json({ error: e.message || '存储错误' }, { status: e.status || 500 });
    }
  },
};
