import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Reuse the pinned, already installed P0 toolchain. No FFmpeg build or model call.
const require = createRequire(new URL('../experiments/workers-p0/package.json', import.meta.url));
const base = 'G:/DevCache/Temp/pi-agent-hypite/workers-storage';
await mkdir(base, { recursive: true });
const output = await mkdtemp(path.join(base, 'run-'));
process.env.TEMP = output; process.env.TMP = output;
const { build } = require('esbuild'), { Miniflare, Log, LogLevel } = require('miniflare');
const report = { schema: 'pi-studio.worker-storage-verification@1', startedAt: new Date().toISOString(), environment: 'local workerd only', output, checks: [], sources: {}, cloudVerified: false, executionEnabled: false };
let runtime;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const workspaceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tokenA = 'local-test-a', tokenB = 'local-test-b';
function start(enabled = true) {
  return new Miniflare({
    modules: true, modulesRoot: output, scriptPath: path.join(output, 'worker.js'), compatibilityDate: '2026-07-30',
    bindings: enabled ? { LOCAL_STORAGE_TEST_ONLY: 'true' } : {},
    d1Databases: ['DB'], d1Persist: path.join(output, 'd1'),
    r2Buckets: ['MEDIA'], r2Persist: path.join(output, 'r2'),
    log: new Log(LogLevel.WARN),
  });
}
async function request(route, { token = tokenA, method = 'GET', body, bytes, headers = {} } = {}) {
  return runtime.dispatchFetch('https://storage.test' + route, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : bytes ? { body: bytes } : {}),
  });
}
async function json(route, options, status = 200) {
  const response = await request(route, options), data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
async function verify(name, fn) { await fn(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
let project, ref, frozenBatch;
const referenceBytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
try {
  execFileSync(process.execPath, [path.join(root, 'experiments/workers-p0/node_modules/typescript/bin/tsc'), '-p', 'experiments/workers-storage/tsconfig.json'], { cwd: root, stdio: 'pipe', env: { ...process.env, TEMP: output, TMP: output } });
  const bundle = await build({ absWorkingDir: root, entryPoints: ['experiments/workers-storage/worker.ts'], outfile: path.join(output, 'worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true });
  assert.ok(Object.keys(bundle.metafile.inputs).every(name => !/(^|\/)vendor\/|node_modules|local-repository|saas\/store/.test(name)));
  for (const file of [...Object.keys(bundle.metafile.inputs), 'packages/cloudflare-storage/schema.sql', 'scripts/verify-worker-storage.mjs']) report.sources[file] = digest(await readFile(path.join(root, file)));
  await writeFile(path.join(output, 'metafile.json'), JSON.stringify(bundle.metafile, null, 2));
  await verify('TypeScript 和纯 Worker 构建通过，产物不含 Node 存储、Pi CLI 或 Hypit', async () => {});
  runtime = start(false);
  await verify('实验入口默认关闭；未配置测试标记返回 503', async () => { assert.equal((await request('/api/remix')).status, 503); });
  await runtime.dispose(); runtime = start();
  const schema = (await readFile(path.join(root, 'packages/cloudflare-storage/schema.sql'), 'utf8')).replace(/^--.*$/gm, '');
  let db = await runtime.getD1Database('DB');
  for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  await verify('未认证、伪造身份和客户端 workspaceId 不改变服务器归属', async () => {
    await json('/api/remix', { token: null }, 401);
    await json('/api/remix', { token: 'constructor' }, 401);
    project = await json('/api/remix', { method: 'POST', body: { requestId: randomUUID(), title: 'Worker 存储实验', workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } });
    await json('/api/remix/' + project.id, { token: tokenB }, 404);
    assert.deepEqual(await json('/api/remix', { token: tokenB }), []);
  });
  await verify('并发重复创建只有一份记录，冲突请求与跨空间占用均拒绝', async () => {
    const body = { requestId: randomUUID(), title: '并发创建' };
    const pair = await Promise.all([json('/api/remix', { method: 'POST', body }), json('/api/remix', { method: 'POST', body })]);
    assert.equal(pair[0].id, pair[1].id);
    assert.equal(pair[0].revision, pair[1].revision);
    await json('/api/remix', { method: 'POST', body: { ...body, title: '其他意图' } }, 409);
    await json('/api/remix', { method: 'POST', body, token: tokenB }, 409);
  });
  await verify('R2 校验哈希、按范围流式读取、HEAD 和跨空间素材隔离', async () => {
    const registration = await json(`/test/fixtures/${project.id}/asset`, { method: 'POST', bytes: referenceBytes });
    ref = registration.assetId;
    project = await json('/api/remix/' + project.id);
    assert.equal(project.assets[0].available, true);
    assert.equal(project.assets[0].sha256, digest(referenceBytes));
    const url = project.assets[0].url;
    const full = await request(url); assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), referenceBytes);
    for (const [range, expected, expectedRange] of [['bytes=4-7', referenceBytes.subarray(4, 8), 'bytes 4-7/16'], ['bytes=-4', referenceBytes.subarray(12), 'bytes 12-15/16']]) {
      const part = await request(url, { headers: { Range: range } });
      assert.equal(part.status, 206); assert.equal(part.headers.get('Content-Range'), expectedRange);
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), expected);
    }
    for (const range of ['bytes=-0', 'bytes=16-', 'bytes=4-2', 'bytes=0-1,4-5', 'bytes=9007199254740992-']) assert.equal((await request(url, { headers: { Range: range } })).status, 416);
    const head = await request(url, { method: 'HEAD' });
    assert.equal(head.headers.get('Content-Length'), '16'); assert.equal(await head.text(), '');
    await json(url, { token: tokenB }, 404);
    await json(url, { token: null }, 401);
    const bucket = await runtime.getR2Bucket('MEDIA');
    await assert.rejects(bucket.put('bad-checksum-test', referenceBytes, { sha256: '0'.repeat(64) }));
    assert.equal(await bucket.head('bad-checksum-test'), null);
  });
  await verify('并发登记不同素材不丢记录，同哈希重试复用原素材 ID', async () => {
    const fixtures = [Buffer.concat([referenceBytes, Buffer.from([1])]), Buffer.concat([referenceBytes, Buffer.from([2])])];
    const registered = await Promise.all(fixtures.map(bytes => json(`/test/fixtures/${project.id}/asset`, { method: 'POST', bytes })));
    project = await json('/api/remix/' + project.id);
    assert.equal(project.assets.length, 3);
    assert.ok(registered.every(entry => project.assets.some(asset => asset.id === entry.assetId && asset.available)));
    const repeated = await json(`/test/fixtures/${project.id}/asset`, { method: 'POST', bytes: referenceBytes });
    assert.deepEqual(repeated, { assetId: ref, duplicate: true });
    assert.equal((await json('/api/remix/' + project.id)).assets.length, 3);
  });
  await verify('并发编辑同一 revision 仅一个成功，准备检查只读，execute 仍阻断', async () => {
    const plan = { referenceId: ref, preserve: '保留节奏', rows: [{ key: '镜头', type: 'video', start: 0, end: 15, assetId: ref, value: '' }, { key: '字幕', type: 'text', start: 0, end: 15, assetId: '', value: '商品卖点' }] };
    const results = await Promise.all(['编辑 A', '编辑 B'].map(preserve => request(`/api/remix/${project.id}/plan`, { method: 'POST', body: { revision: project.revision, plan: { ...plan, preserve } } })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    project = await json('/api/remix/' + project.id);
    assert.ok(['编辑 A', '编辑 B'].includes(project.plan.preserve));
    const snapshot = structuredClone(project);
    const check = await json(`/api/remix/${project.id}/check`, { method: 'POST', body: { revision: project.revision } });
    assert.equal(check.canExecute, false);
    assert.deepEqual(await json('/api/remix/' + project.id), snapshot);
    await json(`/api/remix/${project.id}/execute`, { method: 'POST', body: {} }, 409);
  });
  await verify('批次并发重试幂等；复制保留旧方案且生成独立变体', async () => {
    const body = { requestId: randomUUID(), title: '第一批', revision: project.revision, variants: [{ label: 'A', overrides: {} }] };
    const pair = await Promise.all([json(`/api/remix/${project.id}/batches`, { method: 'POST', body }), json(`/api/remix/${project.id}/batches`, { method: 'POST', body })]);
    assert.equal(pair[0].batches.length, 1); assert.equal(pair[1].batches.length, 1);
    project = pair[0]; frozenBatch = structuredClone(project.batches[0]);
    project = await json(`/api/remix/${project.id}/plan`, { method: 'POST', body: { revision: project.revision, plan: { ...project.plan, preserve: '新的工作方案' } } });
    project = await json(`/api/remix/${project.id}/batches`, { method: 'POST', body: { ...body, requestId: randomUUID(), revision: project.revision, title: '从旧批次继续', sourceBatchId: frozenBatch.id } });
    assert.deepEqual(project.batches[0], frozenBatch);
    assert.deepEqual(project.batches[1].plan, frozenBatch.plan);
    assert.notEqual(project.batches[1].variants[0].id, frozenBatch.variants[0].id);
    await json(`/api/remix/${project.id}/batches`, { token: tokenB, method: 'POST', body }, 404);
  });
  await verify('R2 缺失、同大小损坏、缺校验和均不可用，文件恢复不改方案 revision', async () => {
    const bucket = await runtime.getR2Bucket('MEDIA'), key = `workspaces/${workspaceA}/projects/${project.id}/assets/${ref}`, revision = project.revision;
    await bucket.delete(key);
    let shown = await json('/api/remix/' + project.id);
    assert.equal(shown.assets[0].available, false); assert.equal(shown.revision, revision);
    await json(shown.assets[0].url, {}, 404);
    await bucket.put(key, Buffer.alloc(referenceBytes.length), { sha256: digest(Buffer.alloc(referenceBytes.length)) });
    shown = await json('/api/remix/' + project.id); assert.equal(shown.assets[0].available, false);
    await json(shown.assets[0].url, {}, 409);
    await bucket.put(key, referenceBytes);
    assert.equal((await json('/api/remix/' + project.id)).assets[0].available, false);
    await bucket.put(key, referenceBytes, { sha256: digest(referenceBytes) });
    project = await json('/api/remix/' + project.id);
    assert.equal(project.assets[0].available, true); assert.equal(project.revision, revision);
  });
  await verify('workerd 重启后 D1 项目、批次和 R2 原字节仍可读取', async () => {
    const before = structuredClone(project);
    await runtime.dispose(); runtime = start();
    project = await json('/api/remix/' + project.id);
    assert.deepEqual(project, before);
    const bytes = await request(project.assets[0].url);
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), referenceBytes);
  });
  await verify('超过 D1 文档预算时明确拒绝，已保存的方案和批次不发生部分写入', async () => {
    let large = await json('/api/remix', { method: 'POST', body: { requestId: randomUUID(), title: '文档预算测试' } });
    const entry = await json(`/test/fixtures/${large.id}/asset`, { method: 'POST', bytes: referenceBytes });
    large = await json('/api/remix/' + large.id);
    const plan = { referenceId: entry.assetId, preserve: '', rows: Array.from({ length: 40 }, (_, i) => ({ key: '文案' + i, type: 'text', start: 0, end: 15, value: 'x'.repeat(2000), assetId: '' })) };
    large = await json(`/api/remix/${large.id}/plan`, { method: 'POST', body: { revision: large.revision, plan } });
    const result = await json(`/api/remix/${large.id}/batches`, { method: 'POST', body: { revision: large.revision, requestId: randomUUID(), title: '超过云存储预算', variants: Array.from({ length: 20 }, (_, i) => ({ label: String(i), overrides: {} })) } }, 413);
    assert.match(result.error, /云端单项目容量/);
    assert.deepEqual(await json('/api/remix/' + large.id), large);
  });
  await verify('并发创建不能突破每空间 100 项上限', async () => {
    db = await runtime.getD1Database('DB');
    const { n } = await db.prepare('SELECT count(*) AS n FROM remix_projects WHERE workspace_id=?').bind(workspaceA).first();
    const statements = Array.from({ length: 99 - n }, () => {
      const document = { id: 'remix_' + randomUUID(), title: '配额测试', createdAt: new Date().toISOString(), assets: [], plan: { rows: [] }, batches: [] };
      const serialized = JSON.stringify(document);
      return db.prepare('INSERT INTO remix_projects VALUES (?,?,?,?)').bind(document.id, workspaceA, serialized, digest(serialized));
    });
    await db.batch(statements);
    const results = await Promise.all(['上限 A', '上限 B'].map(title => request('/api/remix', { method: 'POST', body: { requestId: randomUUID(), title } })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM remix_projects WHERE workspace_id=?').bind(workspaceA).first()).n, 100);
    const listing = await json('/api/remix');
    assert.equal(listing.length, 100);
    assert.deepEqual(listing.find(item => item.id === project.id), { id: project.id, title: project.title, createdAt: project.createdAt, assets: project.assets.length, batches: project.batches.length });
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error.stack || error);
  if (error.stdout) console.error(String(error.stdout));
  console.error(error); process.exitCode = 1;
} finally {
  if (runtime) await runtime.dispose().catch(error => { report.disposeError = String(error); process.exitCode = 1; report.passed = false; });
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.join(output, 'report.json'));
}
