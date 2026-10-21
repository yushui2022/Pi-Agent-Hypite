// Production Workers entry for the SaaS API.
//
// Mirrors the routes of apps/saas-api/server.mjs so one frontend serves both backends. The one
// deliberate difference is uploads: the local server receives base64 chunks, while here the
// browser PUTs straight to R2 (authorize -> PUT -> complete). 100 MB cannot pass through a Worker.
//
// Identity always comes from a verified server-side session. No route reads a workspace id from
// request input.
import { createRemixService } from '../../../packages/remix/service.mjs';
import { createD1Repository } from '../../../packages/cloudflare-storage/d1';
import { createR2Media } from '../../../packages/cloudflare-storage/r2';
import {
  register, login, logout, identify,
  readSessionToken, sessionCookie, clearSessionCookie,
} from '../../../packages/cloudflare-storage/session';
import { authorizeUpload, completeUpload } from '../../../packages/cloudflare-storage/upload';
import type { S3Config } from '../../../packages/cloudflare-storage/upload';
import { fault } from '../../../packages/remix/revision.mjs';
import { providerStatus, probeTokensFactory, probeAutoDL } from './providers';
import type { ProviderEnv } from './providers';
import { submitVideo, pollVideo } from './video';
import type { VideoEnv, AutoDLResolution } from './video';
import { presignS3Url } from '../../../packages/cloudflare-storage/sigv4';

interface Env extends ProviderEnv, VideoEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
});

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) throw fault('需要 JSON 请求', 415);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw fault('请求过大', 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw fault('JSON 无效'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fault('请求无效');
  return body as Record<string, unknown>;
}

/** Matches the shape packages/saas/store.mjs returns so the frontend cannot tell the difference. */
const publicUser = (account: { userId: string; email: string; name: string; workspaceId: string; workspaceName: string }) => ({
  id: account.userId, email: account.email, name: account.name,
  workspace_id: account.workspaceId, workspace_name: account.workspaceName,
});

const s3Config = (env: Env): S3Config => ({
  endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, region: 'auto',
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const secure = url.protocol === 'https:';
    // SameSite=Strict already blocks cross-site cookie sends; this rejects the request outright.
    const origin = request.headers.get('Origin');
    if (!['GET', 'HEAD'].includes(method) && origin && origin !== url.origin) return json({ error: '拒绝跨站请求' }, 403);

    try {
      if (url.pathname === '/healthz' && method === 'GET') return json({ ok: true });

      if (method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
        const body = await readJson(request);
        const result = url.pathname.endsWith('register') ? await register(env.DB, body) : await login(env.DB, body);
        const previous = readSessionToken(request);
        if (previous) await logout(env.DB, previous);
        return json({ user: publicUser(result.account) }, 200, { 'Set-Cookie': sessionCookie(result.token, secure) });
      }
      if (method === 'POST' && url.pathname === '/api/auth/logout') {
        await logout(env.DB, readSessionToken(request));
        return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) });
      }

      // Everything below requires a verified session.
      const account = await identify(env.DB, readSessionToken(request));
      const repository = createD1Repository(env.DB, account.workspaceId);
      const media = createR2Media(env.MEDIA, account.workspaceId);
      const service = createRemixService({ repository, media });

      if (method === 'GET' && url.pathname === '/api/auth/me') {
        return json({ user: publicUser(account), mode: 'workers', generation: false });
      }

      // Provider configuration and free connectivity probes. Authenticated: the answers name
      // services and models, which is not public information.
      if (method === 'GET' && url.pathname === '/api/providers') return json(providerStatus(env));
      if (method === 'POST' && url.pathname === '/api/providers/probe') {
        if (!env.TOKENSFACTORY_API_KEY && !env.AUTODL_API_KEY) throw fault('生成服务尚未配置', 409);
        const [tokensFactory, autoDL] = await Promise.all([probeTokensFactory(env), probeAutoDL(env)]);
        return json({ tokensFactory, autoDL });
      }

      // Video generation. Assets are private in R2, so each reference image is handed to AutoDL
      // as a short-lived signed URL. Nothing here downloads the result yet: the caller polls.
      if (method === 'POST' && url.pathname === '/api/video/submit') {
        const body = await readJson(request);
        const projectId = String(body.projectId ?? '');
        const project = await service.read(projectId); // ownership check
        const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(String) : [];
        const audioIds = Array.isArray(body.audioAssetIds) ? body.audioAssetIds.map(String) : [];
        if (!assetIds.length) throw fault('至少选择一张参考图片', 400);
        if (!env.AUTODL_API_KEY) throw fault('视频生成服务未配置', 409);
        const signAsset = async (assetId: string) => {
          const asset = project.assets.find((item: { id: string }) => item.id === assetId);
          if (!asset) throw fault('素材不存在或不属于该项目', 404);
          const signed = await presignS3Url({
            method: 'GET', endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET,
            key: `workspaces/${account.workspaceId}/projects/${projectId}/assets/${assetId}`,
            accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            expiresSeconds: 3600,
          });
          return signed.url;
        };
        const images = await Promise.all(assetIds.map(signAsset));
        const audio = await Promise.all(audioIds.map(signAsset));
        const task = await submitVideo(env, {
          variant: body.variant === 'fast' ? 'fast' : 'default',
          prompt: String(body.prompt ?? ''),
          images, audio,
          duration: body.duration === undefined ? 5 : Number(body.duration),
          resolution: typeof body.resolution === 'string' ? body.resolution as AutoDLResolution : '768p竖',
          seed: body.seed === undefined ? undefined : Number(body.seed),
        });
        return json({ taskId: task.taskId, projectId, submittedAt: new Date().toISOString() }, 202);
      }
      const videoTask = /^\/api\/video\/tasks\/([a-f0-9-]{36})$/i.exec(url.pathname);
      if (method === 'GET' && videoTask) {
        return json(await pollVideo(env, videoTask[1]));
      }

      // Direct upload: the browser gets a signed URL, then reports back for verification.
      if (method === 'POST' && url.pathname === '/api/uploads') {
        const body = await readJson(request);
        await repository.read(String(body.projectId)); // ownership before a URL exists
        return json({ upload: await authorizeUpload(env.DB, account.workspaceId, body, s3Config(env)) }, 201);
      }
      const completion = /^\/api\/uploads\/(upload_[a-f0-9-]{36})\/complete$/.exec(url.pathname);
      if (method === 'POST' && completion) {
        const asset = await completeUpload(env.DB, env.MEDIA, account.workspaceId, completion[1]);
        // Registration happens only after storage verified the bytes.
        const registered = await service.registerAsset(asset.projectId, {
          id: asset.assetId, name: asset.name, mime: asset.mime, size: asset.size,
          sha256: asset.sha256, createdAt: asset.createdAt,
        });
        return json({ ...registered, projectId: asset.projectId });
      }

      const mediaRoute = /^\/api\/media\/(remix_[a-f0-9-]{36})\/(asset_[a-f0-9-]{36})$/.exec(url.pathname);
      if (mediaRoute && ['GET', 'HEAD'].includes(method)) {
        const asset = await service.asset(mediaRoute[1], mediaRoute[2]);
        const response = await media.respond(mediaRoute[1], asset, request);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      }

      if (url.pathname === '/api/remix' && method === 'GET') return json(await service.list());
      if (url.pathname === '/api/remix' && method === 'POST') return json(await service.create(await readJson(request)), 201);

      const match = /^\/api\/remix\/(remix_[a-f0-9-]{36})(?:\/(plan|batches|check|execute))?$/.exec(url.pathname);
      if (match) {
        const [, id, action] = match;
        if (method === 'GET' && !action) return json(await service.show(id));
        if (method === 'POST' && action) {
          await repository.read(id); // ownership is checked before every action
          if (action === 'execute') throw fault('当前只开放创作准备，真实制作服务尚未接入', 409);
          const body = await readJson(request);
          if (action === 'plan') return json(await service.savePlan(id, body));
          if (action === 'batches') return json(await service.makeBatch(id, body));
          return json(await service.check(id, body));
        }
      }
      throw fault('接口不存在', 404);
    } catch (error) {
      const e = error as { status?: number; message?: string; code?: string };
      // Server-side only: the client gets a generic message, the log gets the diagnosis.
      console.error(JSON.stringify({ path: url.pathname, status: e.status ?? 500, code: e.code ?? null, message: e.message ?? String(error) }));
      if (e.code === 'ENOENT') return json({ error: '项目或素材不存在' }, 404);
      return json({ error: e.status ? e.message : '服务暂不可用，请稍后重试' }, e.status ?? 500);
    }
  },
};
