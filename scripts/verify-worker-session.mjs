// Verifies the Worker account/session flow against a real local workerd.
//
// The point is not that endpoints answer: it is that identity comes from a verified session,
// that password storage is the format the Worker can actually verify, and that a hash the
// Worker cannot verify is reported honestly instead of looking like a wrong password.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../experiments/workers-p0/package.json', import.meta.url));
const base = 'G:/DevCache/Temp/pi-agent-hypite/worker-session';
await mkdir(base, { recursive: true });
const output = await mkdtemp(path.join(base, 'run-'));
process.env.TEMP = output; process.env.TMP = output;
const { build } = require('esbuild'), { Miniflare, Log, LogLevel } = require('miniflare');

const report = { schema: 'pi-studio.worker-session-verification@1', startedAt: new Date().toISOString(), environment: 'local workerd only', output, checks: [], cloudVerified: false };
async function verify(name, fn) { await fn(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
const json = async (response, status) => {
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
};
const cookieOf = response => {
  const header = response.headers.get('Set-Cookie') ?? '';
  return header.split(';')[0];
};

function start(testOnly = true) {
  return new Miniflare({
    modules: true, modulesRoot: output, scriptPath: path.join(output, 'worker.js'), compatibilityDate: '2026-07-30',
    bindings: testOnly ? {
      LOCAL_STORAGE_TEST_ONLY: 'true',
      S3_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com', S3_BUCKET: 'pi-media',
      S3_ACCESS_KEY_ID: 'AKIDEXAMPLE', S3_SECRET_ACCESS_KEY: 'secret-example',
    } : {},
    d1Databases: ['DB'], d1Persist: path.join(output, 'd1'),
    r2Buckets: ['MEDIA'], r2Persist: path.join(output, 'r2'),
    log: new Log(LogLevel.WARN),
  });
}

let runtime;
const call = (route, { method = 'GET', body, cookie } = {}) => runtime.dispatchFetch('https://session.test' + route, {
  method,
  headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

try {
  execFileSync(process.execPath, [path.join(root, 'experiments/workers-p0/node_modules/typescript/bin/tsc'), '-p', 'experiments/workers-storage/tsconfig.json'], { cwd: root, stdio: 'pipe', env: { ...process.env, TEMP: output, TMP: output } });
  await build({ absWorkingDir: root, entryPoints: ['experiments/workers-storage/session-worker.ts'], outfile: path.join(output, 'worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  await verify('TypeScript 与纯 Worker 构建通过', async () => {});

  runtime = start(false);
  await verify('未配置测试标记时入口关闭', async () => {
    assert.equal((await call('/api/session')).status, 503);
  });
  await runtime.dispose();

  runtime = start();
  const schema = (await readFile(path.join(root, 'packages/cloudflare-storage/schema.sql'), 'utf8')).replace(/^--.*$/gm, '');
  const db = await runtime.getD1Database('DB');
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();

  let cookieA;
  await verify('注册在同一批次建立用户、空间、成员与会话', async () => {
    const response = await call('/api/auth/register', { method: 'POST', body: { email: 'a@example.test', password: 'correct-horse-9', name: '甲' } });
    const body = await json(response, 200);
    assert.match(body.user.workspaceId, /^[a-f0-9-]{36}$/);
    cookieA = cookieOf(response);
    assert.ok(cookieA.startsWith('pi_saas_session='), cookieA);
    const counts = await Promise.all(['users', 'workspaces', 'memberships', 'sessions'].map(async table =>
      (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n));
    assert.deepEqual(counts, [1, 1, 1, 1]);
    assert.equal(body.user.name, '甲');
    assert.equal(body.user.workspaceName, '甲的创作空间');
  });

  await verify('会话 Cookie 使用 HttpOnly、SameSite=Strict 与 Path=/', async () => {
    const response = await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'correct-horse-9' } });
    const header = response.headers.get('Set-Cookie') ?? '';
    for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(header.includes(attribute), attribute);
    assert.ok(Number(/Max-Age=(\d+)/.exec(header)?.[1]) > 0);
    // The harness dispatches an https URL, so Secure must be present there and absent over http.
    assert.ok(header.includes('Secure'), 'https 请求必须带 Secure');
    const plain = await runtime.dispatchFetch('http://session.test/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.test', password: 'correct-horse-9' }),
    });
    assert.ok(!(plain.headers.get('Set-Cookie') ?? '').includes('Secure'), 'http 请求不应带 Secure');
  });

  await verify('身份只来自服务端会话，密码以 PBKDF2 格式存储', async () => {
    const session = await json(await call('/api/session', { cookie: cookieA }), 200);
    const row = await db.prepare('SELECT workspace_id FROM sessions LIMIT 1').first();
    assert.equal(session.user.workspaceId, row.workspace_id, '工作空间必须来自会话记录');
    const user = await db.prepare('SELECT salt,password_hash FROM users LIMIT 1').first();
    assert.match(user.password_hash, /^pbkdf2-sha256\$210000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    assert.match(user.salt, /^[a-f0-9]{32}$/);
  });

  await verify('错误密码与不存在的账号返回相同响应，不泄露账号是否存在', async () => {
    const wrong = await json(await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'wrong-password-1' } }), 401);
    const missing = await json(await call('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.test', password: 'wrong-password-1' } }), 401);
    assert.equal(wrong.error, missing.error);
    assert.equal(wrong.code, undefined);
  });

  await verify('重复邮箱注册返回 409 且不新增用户', async () => {
    await json(await call('/api/auth/register', { method: 'POST', body: { email: 'a@example.test', password: 'another-password', name: '甲二' } }), 409);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM users').first()).n, 1);
  });

  await verify('登出后旧 Cookie 失效，该会话记录被删除', async () => {
    const token = cookieA.slice('pi_saas_session='.length);
    const digest = createHash('sha256').update(token).digest('hex');
    const before = (await db.prepare('SELECT count(*) AS n FROM sessions').first()).n;
    assert.ok(await db.prepare('SELECT 1 AS x FROM sessions WHERE token_hash=?').bind(digest).first(), '登出前应存在该会话');
    await json(await call('/api/auth/logout', { method: 'POST', cookie: cookieA }), 200);
    await json(await call('/api/session', { cookie: cookieA }), 401);
    assert.equal(await db.prepare('SELECT 1 AS x FROM sessions WHERE token_hash=?').bind(digest).first(), null, '该会话记录应被删除');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions').first()).n, before - 1, '其他设备的会话不受影响');
  });

  await verify('伪造与过期的令牌都被拒绝', async () => {
    await json(await call('/api/session', { cookie: 'pi_saas_session=' + 'b'.repeat(64) }), 401);
    const login = await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'correct-horse-9' } });
    const cookie = cookieOf(login);
    await db.prepare('UPDATE sessions SET expires_at=?').bind(Date.now() - 1000).run();
    await json(await call('/api/session', { cookie }), 401);
  });

  await verify('本地 scrypt 哈希无法在 Worker 校验，明确要求重设密码而不是报密码错误', async () => {
    await json(await call('/test/legacy-account', { method: 'POST', body: { email: 'legacy@example.test' } }), 200);
    const body = await json(await call('/api/auth/login', { method: 'POST', body: { email: 'legacy@example.test', password: 'any-password-1' } }), 401);
    assert.equal(body.code, 'password-reset-required', JSON.stringify(body));
  });

  await verify('两个空间互不可见', async () => {
    const response = await call('/api/auth/register', { method: 'POST', body: { email: 'b@example.test', password: 'correct-horse-9', name: '乙' } });
    const cookieB = cookieOf(response);
    const b = await json(await call('/api/session', { cookie: cookieB }), 200);
    await db.prepare('INSERT INTO remix_projects(id,workspace_id,document,revision) VALUES (?,?,?,?)')
      .bind('remix_55555555-5555-4555-8555-555555555555', b.user.workspaceId, JSON.stringify({ id: 'remix_55555555-5555-4555-8555-555555555555' }), 'c'.repeat(64)).run();
    const seenByB = await json(await call('/api/remix', { cookie: cookieB }), 200);
    assert.deepEqual(seenByB.ids, ['remix_55555555-5555-4555-8555-555555555555']);
    const a = await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'correct-horse-9' } });
    const seenByA = await json(await call('/api/remix', { cookie: cookieOf(a) }), 200);
    assert.deepEqual(seenByA.ids, [], '甲不应看到乙的项目');
    assert.notEqual(seenByA.workspaceId, seenByB.workspaceId);
  });

  let cookieA2, projectA, upload, uploadSha;
  await verify('申请上传返回带空间前缀的签名 URL，校验和强制参与签名', async () => {
    const login = await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'correct-horse-9' } });
    cookieA2 = cookieOf(login);
    const me = await json(await call('/api/session', { cookie: cookieA2 }), 200);
    projectA = 'remix_66666666-6666-4666-8666-666666666666';
    await db.prepare('INSERT INTO remix_projects(id,workspace_id,document,revision) VALUES (?,?,?,?)')
      .bind(projectA, me.user.workspaceId, JSON.stringify({ id: projectA }), 'e'.repeat(64)).run();
    const bytes = Buffer.from('synthetic-mp4-payload');
    uploadSha = createHash('sha256').update(bytes).digest('hex');
    upload = (await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { projectId: projectA, name: 'ref.mp4', mime: 'video/mp4', size: bytes.length, sha256: uploadSha } }), 200)).upload;
    assert.ok(upload.key.startsWith(`workspaces/${me.user.workspaceId}/projects/${projectA}/assets/asset_`), upload.key);
    const url = new URL(upload.url);
    assert.equal(url.host, 'acct123.r2.cloudflarestorage.com');
    assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host;x-amz-checksum-sha256');
    assert.equal(upload.headers['x-amz-checksum-sha256'], createHash('sha256').update(bytes).digest('base64'));
  });

  await verify('不合规的上传申请被拒绝', async () => {
    const valid = { projectId: projectA, name: 'a.mp4', mime: 'video/mp4', size: 10, sha256: uploadSha };
    await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { ...valid, size: 100_000_001 } }), 413);
    await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { ...valid, mime: 'text/plain' } }), 415);
    await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { ...valid, sha256: 'nope' } }), 400);
    // A project in another workspace answers like a missing one, before any URL is issued.
    await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { ...valid, projectId: 'remix_77777777-7777-4777-8777-777777777777' } }), 404);
  });

  await verify('未上传就确认会被拒绝，并作废该申请', async () => {
    await json(await call(`/api/uploads/${upload.uploadId}/complete`, { method: 'POST', cookie: cookieA2 }), 409);
    const row = await db.prepare('SELECT state FROM uploads WHERE id=?').bind(upload.uploadId).first();
    assert.equal(row.state, 'failed');
  });

  await verify('校验和不匹配时拒绝确认并删除对象', async () => {
    const bucket = await runtime.getR2Bucket('MEDIA');
    const bytes = Buffer.from('tampered-payload');
    const pending = (await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { projectId: projectA, name: 't.mp4', mime: 'video/mp4', size: bytes.length, sha256: uploadSha } }), 200)).upload;
    // The object lands with its own real checksum, which cannot match the declared one.
    await bucket.put(pending.key, bytes, { sha256: createHash('sha256').update(bytes).digest() });
    await json(await call(`/api/uploads/${pending.uploadId}/complete`, { method: 'POST', cookie: cookieA2 }), 422);
    assert.equal(await bucket.head(pending.key), null, '被拒绝的对象必须删除');
  });

  await verify('校验和一致时确认通过并返回真实哈希，重复确认被拒绝', async () => {
    const bucket = await runtime.getR2Bucket('MEDIA');
    const bytes = Buffer.from('verified-video-bytes');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const pending = (await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { projectId: projectA, name: 'ok.mp4', mime: 'video/mp4', size: bytes.length, sha256: sha } }), 200)).upload;
    await bucket.put(pending.key, bytes, { sha256: createHash('sha256').update(bytes).digest() });
    const done = await json(await call(`/api/uploads/${pending.uploadId}/complete`, { method: 'POST', cookie: cookieA2 }), 200);
    assert.equal(done.asset.assetId, pending.assetId);
    assert.equal(done.asset.sha256, sha);
    assert.equal(done.asset.size, bytes.length);
    assert.ok(await bucket.head(pending.key), '通过确认的对象必须保留');
    await json(await call(`/api/uploads/${pending.uploadId}/complete`, { method: 'POST', cookie: cookieA2 }), 409);
  });

  await verify('其他空间不能确认我的上传', async () => {
    const bytes = Buffer.from('cross-tenant-attempt');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const pending = (await json(await call('/api/uploads', { method: 'POST', cookie: cookieA2, body: { projectId: projectA, name: 'x.mp4', mime: 'video/mp4', size: bytes.length, sha256: sha } }), 200)).upload;
    const other = await call('/api/auth/login', { method: 'POST', body: { email: 'b@example.test', password: 'correct-horse-9' } });
    await json(await call(`/api/uploads/${pending.uploadId}/complete`, { method: 'POST', cookie: cookieOf(other) }), 404);
  });

  await verify('过期申请不能确认', async () => {
    await db.prepare('UPDATE uploads SET expires_at=?, state=? WHERE id=?').bind(Date.now() - 1000, 'pending', upload.uploadId).run();
    await json(await call(`/api/uploads/${upload.uploadId}/complete`, { method: 'POST', cookie: cookieA2 }), 409);
  });

  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  if (runtime) await runtime.dispose();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)).catch(() => {});
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, output, error: report.error }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
