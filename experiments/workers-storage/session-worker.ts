// LOCAL TEST HARNESS for the Worker account and session flow.
// Gated behind LOCAL_STORAGE_TEST_ONLY like the storage harness; not a deployable entry.
import {
  register, login, logout, identify, credentials,
  sessionCookie, clearSessionCookie, readSessionToken, hashPassword,
} from '../../packages/cloudflare-storage/session';
import { createD1Repository } from '../../packages/cloudflare-storage/d1';
import { fault } from '../../packages/remix/revision.mjs';

interface Env { DB: D1Database; LOCAL_STORAGE_TEST_ONLY?: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.LOCAL_STORAGE_TEST_ONLY !== 'true') return new Response(null, { status: 503 });
    const url = new URL(request.url), method = request.method;
    // Local workerd runs over http; a real deployment would see https and get Secure.
    const secure = url.protocol === 'https:';
    try {
      if (url.pathname === '/api/auth/register' && method === 'POST') {
        const { token, account } = await register(env.DB, await request.json());
        return Response.json({ user: account }, { headers: { 'Set-Cookie': sessionCookie(token, secure) } });
      }
      if (url.pathname === '/api/auth/login' && method === 'POST') {
        const { token, account } = await login(env.DB, await request.json());
        return Response.json({ user: account }, { headers: { 'Set-Cookie': sessionCookie(token, secure) } });
      }
      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        await logout(env.DB, readSessionToken(request));
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(secure) } });
      }
      // Test-only fixture: an account whose password hash is the local server's scrypt format.
      if (url.pathname === '/test/legacy-account' && method === 'POST') {
        const { email } = credentials({ ...(await request.json() as object), password: 'placeholder-pass' });
        const userId = crypto.randomUUID(), workspaceId = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO users(id,email,name,salt,password_hash) VALUES (?,?,?,?,?)')
            .bind(userId, email, '旧账号', 'salt', 'a'.repeat(128)),
          env.DB.prepare('INSERT INTO workspaces(id,name) VALUES (?,?)').bind(workspaceId, '旧空间'),
          env.DB.prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)').bind(userId, workspaceId, 'owner'),
        ]);
        return Response.json({ ok: true, workspaceId });
      }

      // Everything below requires a verified server-side session.
      const account = await identify(env.DB, readSessionToken(request));
      if (url.pathname === '/api/session' && method === 'GET') return Response.json({ user: account });
      if (url.pathname === '/api/remix' && method === 'GET') {
        return Response.json({ workspaceId: account.workspaceId, ids: await createD1Repository(env.DB, account.workspaceId).ids() });
      }
      throw fault('接口不存在', 404);
    } catch (error) {
      const e = error as { status?: number; message?: string; code?: string };
      return Response.json({ error: e.message ?? '认证错误', ...(e.code ? { code: e.code } : {}) }, { status: e.status ?? 500 });
    }
  },
};

// Keep the bundler from tree-shaking the password helpers this harness exercises indirectly.
export const __testOnly = { hashPassword };
