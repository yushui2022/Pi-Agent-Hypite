// Exercises the real Workers entry (apps/saas-worker/src/index.ts) in local workerd.
//
// Unlike verify-worker-session.mjs this does not use a purpose-built harness: it boots the
// production bundle, so route wiring, ownership checks and the upload round-trip are the code
// that would be deployed. Only the S3 credential values are fake, and the browser's PUT to R2
// is simulated by writing the object through the binding.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../experiments/workers-p0/package.json', import.meta.url));
const base = 'G:/DevCache/Temp/pi-agent-hypite/worker-api';
await mkdir(base, { recursive: true });
const output = await mkdtemp(path.join(base, 'run-'));
process.env.TEMP = output; process.env.TMP = output;
const { build } = require('esbuild'), { Miniflare, Log, LogLevel } = require('miniflare');

const report = { schema: 'pi-studio.worker-api-verification@1', startedAt: new Date().toISOString(), environment: 'local workerd booting the production entry', output, checks: [], cloudVerified: false };
async function verify(name, fn) { const detail = await fn(); report.checks.push({ name, passed: true, ...(detail ? { detail } : {}) }); console.log('PASS ' + name); }
const digestHex = bytes => createHash('sha256').update(bytes).digest('hex');

let runtime;
const call = (route, { method = 'GET', body, cookie, origin } = {}) => runtime.dispatchFetch('https://app.test' + route, {
  method,
  headers: {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(origin === null ? {} : { Origin: origin ?? 'https://app.test' }),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const json = async (response, status) => {
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, status, `期望 ${status}，实际 ${response.status}: ${JSON.stringify(data)}`);
  return data;
};
const cookieOf = response => (response.headers.get('Set-Cookie') ?? '').split(';')[0];

try {
  execFileSync(process.execPath, [path.join(root, 'experiments/workers-p0/node_modules/typescript/bin/tsc'), '-p', 'apps/saas-worker/tsconfig.json'], { cwd: root, stdio: 'pipe', env: { ...process.env, TEMP: output, TMP: output } });
  const bundle = await build({ absWorkingDir: root, entryPoints: ['apps/saas-worker/src/index.ts'], outfile: path.join(output, 'worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true });
  const inputs = Object.keys(bundle.metafile.inputs);
  assert.ok(!inputs.some(name => /(^|\/)(node_modules|vendor)\//.test(name)), '生产入口不应打包 Node 依赖或 vendor');
  assert.ok(!inputs.some(name => /local-repository|saas\/store/.test(name)), '生产入口不应带上本地 Node 存储');
  await verify('类型检查与纯 Worker 打包通过，产物不含 Node 存储、Pi CLI 或 Hypit', async () => ({ inputs: inputs.length }));

  runtime = new Miniflare({
    modules: true, modulesRoot: output, scriptPath: path.join(output, 'worker.js'), compatibilityDate: '2026-07-30',
    bindings: {
      S3_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com', S3_BUCKET: 'pi-media',
      S3_ACCESS_KEY_ID: 'AKIDEXAMPLE', S3_SECRET_ACCESS_KEY: 'secret-example',
    },
    d1Databases: ['DB'], d1Persist: path.join(output, 'd1'),
    r2Buckets: ['MEDIA'], r2Persist: path.join(output, 'r2'),
    log: new Log(LogLevel.WARN),
  });
  const db = await runtime.getD1Database('DB'), bucket = await runtime.getR2Bucket('MEDIA');
  const schema = (await readFile(path.join(root, 'packages/cloudflare-storage/schema.sql'), 'utf8')).replace(/^--.*$/gm, '');
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();

  await verify('健康检查可用，未登录访问业务接口返回 401', async () => {
    await json(await call('/healthz'), 200);
    await json(await call('/api/remix', { cookie: '' }), 401);
    await json(await call('/api/auth/me', { cookie: '' }), 401);
  });

  let cookie;
  await verify('注册返回与本地后端相同形状的用户并下发会话 Cookie', async () => {
    const response = await call('/api/auth/register', { method: 'POST', body: { email: 'a@example.test', password: 'correct-horse-9', name: '甲' } });
    const body = await json(response, 200);
    cookie = cookieOf(response);
    assert.match(cookie, /^pi_saas_session=[a-f0-9]{64}$/, cookie);
    assert.equal(body.user.name, '甲');
    assert.equal(body.user.workspace_name, '甲的创作空间');
    assert.match(body.user.workspace_id, /^[a-f0-9-]{36}$/);
    assert.match(body.user.id, /^[a-f0-9-]{36}$/);
    return { user: body.user.name };
  });

  await verify('交叉 Origin 的写请求被拒绝', async () => {
    await json(await call('/api/remix', { method: 'POST', cookie, origin: 'https://evil.test', body: { requestId: crypto.randomUUID(), title: 'x' } }), 403);
  });

  let projectId;
  await verify('创建、列表与详情走同一套业务服务', async () => {
    const requestId = crypto.randomUUID();
    const created = await json(await call('/api/remix', { method: 'POST', cookie, body: { requestId, title: '测试复刻' } }), 201);
    projectId = created.id;
    assert.match(projectId, /^remix_[a-f0-9-]{36}$/);
    const listed = await json(await call('/api/remix', { cookie }), 200);
    assert.ok(Array.isArray(listed) && listed.some(item => (item.id ?? item) === projectId), JSON.stringify(listed).slice(0, 200));
    const detail = await json(await call('/api/remix/' + projectId, { cookie }), 200);
    assert.equal(detail.title, '测试复刻');
    return { projectId };
  });

  const bytes = Buffer.from('synthetic-reference-video-bytes', 'utf8');
  const sha256 = digestHex(bytes);
  let uploadId, assetId;
  await verify('上传授权返回签名 URL，键带本空间前缀', async () => {
    const body = await json(await call('/api/uploads', { method: 'POST', cookie, body: { projectId, name: 'ref.mp4', mime: 'video/mp4', size: bytes.length, sha256 } }), 201);
    uploadId = body.upload.uploadId;
    assetId = body.upload.assetId;
    assert.ok(body.upload.key.includes(`/projects/${projectId}/assets/${assetId}`), body.upload.key);
    const url = new URL(body.upload.url);
    assert.equal(url.host, 'acct123.r2.cloudflarestorage.com');
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host;x-amz-checksum-sha256');
    return { key: body.upload.key.replace(/[a-f0-9-]{36}/g, '<id>') };
  });

  await verify('确认前系统不认这个素材，确认后才登记进项目', async () => {
    const before = await json(await call('/api/remix/' + projectId, { cookie }), 200);
    assert.equal(before.assets.length, 0, '未确认前项目里不应有素材');
    const upload = await db.prepare('SELECT object_key FROM uploads WHERE id=?').bind(uploadId).first();
    // The browser's PUT is simulated by writing the object with its real checksum.
    await bucket.put(upload.object_key, bytes, { sha256: createHash('sha256').update(bytes).digest() });
    const done = await json(await call(`/api/uploads/${uploadId}/complete`, { method: 'POST', cookie }), 200);
    assert.equal(done.assetId, assetId);
    assert.equal(done.duplicate, false);
    const after = await json(await call('/api/remix/' + projectId, { cookie }), 200);
    assert.equal(after.assets.length, 1);
    assert.equal(after.assets[0].sha256, sha256);
    return { assets: after.assets.length };
  });

  await verify('素材可鉴权读取，内容与上传一致', async () => {
    const response = await call(`/api/media/${projectId}/${assetId}`, { cookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'video/mp4');
    assert.equal(digestHex(Buffer.from(await response.arrayBuffer())), sha256);
    assert.equal(await call(`/api/media/${projectId}/${assetId}`, { cookie: '' }).then(r => r.status), 401);
  });

  await verify('保存替换方案与检查可用，执行入口仍为 409', async () => {
    const project = await json(await call('/api/remix/' + projectId, { cookie }), 200);
    const saved = await json(await call(`/api/remix/${projectId}/plan`, { method: 'POST', cookie, body: { revision: project.revision, plan: { referenceId: assetId, preserve: '', rows: [] } } }), 200);
    assert.ok(saved.revision);
    const refreshed = await json(await call('/api/remix/' + projectId, { cookie }), 200);
    const checked = await json(await call(`/api/remix/${projectId}/check`, { method: 'POST', cookie, body: { revision: refreshed.revision } }), 200);
    assert.equal(checked.canExecute, false);
    await json(await call(`/api/remix/${projectId}/execute`, { method: 'POST', cookie, body: {} }), 409);
  });

  await verify('生成服务状态可读，未配置时探测被明确拒绝', async () => {
    const status = await json(await call('/api/providers', { cookie }), 200);
    assert.equal(status.tokensFactory.configured, false, '本地测试未配置密钥');
    assert.equal(status.autoDL.configured, false);
    assert.equal(status.tokensFactory.chatModel, 'gemini-3.8-flash');
    assert.equal(status.autoDL.workflowDefault, 'minimax_h3_zm_u24');
    assert.equal(status.autoDL.workflowFast, 'minimax_h3_zm_u08');
    await json(await call('/api/providers/probe', { method: 'POST', cookie }), 409);
    await json(await call('/api/providers', { cookie: '' }), 401);
  });

  await verify('视频生成：缺参考图与未配置服务都被明确拒绝', async () => {
    await json(await call('/api/video/submit', { method: 'POST', cookie, body: { projectId, assetIds: [], prompt: 'x' } }), 400);
    // 本地测试环境未配置 AUTODL_API_KEY
    await json(await call('/api/video/submit', { method: 'POST', cookie, body: { projectId, assetIds: [assetId], prompt: 'x' } }), 409);
    await json(await call('/api/video/tasks/00000000-0000-0000-0000-000000000000', { cookie }), 500);
  });

  await verify('另一空间看不到该项目，也不能为它申请上传', async () => {
    const other = await call('/api/auth/register', { method: 'POST', body: { email: 'b@example.test', password: 'correct-horse-9', name: '乙' } });
    const cookieB = cookieOf(other);
    await json(await call('/api/remix/' + projectId, { cookie: cookieB }), 404);
    await json(await call('/api/uploads', { method: 'POST', cookie: cookieB, body: { projectId, name: 'x.mp4', mime: 'video/mp4', size: 4, sha256 } }), 404);
    const listB = await json(await call('/api/remix', { cookie: cookieB }), 200);
    assert.deepEqual(listB, [], '乙的项目列表应为空');
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
