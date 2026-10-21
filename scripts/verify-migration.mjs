// Verifies the local -> D1/R2 migration path against a real local workerd.
//
// Nothing here contacts Cloudflare. A synthetic but structurally real data root is built
// with the same SQLite DDL and the same on-disk media layout the SaaS server uses, the
// migration runs against it, and the produced artifacts are loaded into a local D1 database
// and a local R2 bucket. Every claim is a comparison, not a description.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate-to-d1.mjs';
import { projectRevision } from '../packages/remix/revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../experiments/workers-p0/package.json', import.meta.url));
const { Miniflare, Log, LogLevel } = require('miniflare');
const base = 'G:/DevCache/Temp/pi-agent-hypite/d1-migration';
await mkdir(base, { recursive: true });
const output = await mkdtemp(path.join(base, 'run-'));
process.env.TEMP = output; process.env.TMP = output;

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const dataRoot = path.join(output, 'data');
const out = path.join(output, 'export');
const report = { schema: 'pi-studio.d1-migration-verification@1', startedAt: new Date().toISOString(), output, checks: [], cloudApplied: false };
async function verify(name, fn) { await fn(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }

const users = [
  { id: 'u1', email: 'a@example.test', name: '甲', salt: 's1', password_hash: 'h1' },
  { id: 'u2', email: 'b@example.test', name: '乙', salt: 's2', password_hash: 'h2' },
];
const workspaces = [{ id: 'w1', name: '甲的空间' }, { id: 'w2', name: '乙的空间' }];
const assetBytes = id => Buffer.from(`media-bytes-${id}`, 'utf8');
const assetRecord = id => {
  const bytes = assetBytes(id);
  return { id, name: `${id}.mp4`, mime: 'video/mp4', size: bytes.length, sha256: digest(bytes), createdAt: '2026-10-20T00:00:00.000Z', available: true };
};
const document = (id, assetIds) => ({
  id, title: `项目 ${id}`, createdAt: '2026-10-20T00:00:00.000Z',
  assets: assetIds.map(assetRecord),
  plan: { referenceId: assetIds[0], rows: [{ key: 'r1', type: 'video', start: 0, end: 5, assetId: assetIds[0] }] },
  batches: [],
});
const projects = [
  { id: 'remix_11111111-1111-4111-8111-111111111111', workspaceId: 'w1', assetIds: ['asset_aaaa', 'asset_bbbb'] },
  { id: 'remix_22222222-2222-4222-8222-222222222222', workspaceId: 'w1', assetIds: ['asset_cccc'] },
  { id: 'remix_33333333-3333-4333-8333-333333333333', workspaceId: 'w2', assetIds: ['asset_dddd'] },
];

// Same DDL and layout as packages/saas/store.mjs and packages/remix/index.mjs.
async function buildSource() {
  await mkdir(dataRoot, { recursive: true });
  const db = new DatabaseSync(path.join(dataRoot, 'saas.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id),workspace_id TEXT NOT NULL REFERENCES workspaces(id),role TEXT NOT NULL,PRIMARY KEY(user_id,workspace_id));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),workspace_id TEXT NOT NULL REFERENCES workspaces(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),document TEXT NOT NULL);`);
  for (const user of users) db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.id, user.email, user.name, user.salt, user.password_hash);
  for (const workspace of workspaces) db.prepare('INSERT INTO workspaces VALUES (?,?)').run(workspace.id, workspace.name);
  db.prepare('INSERT INTO memberships VALUES (?,?,?)').run('u1', 'w1', 'owner');
  db.prepare('INSERT INTO memberships VALUES (?,?,?)').run('u2', 'w2', 'owner');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('f'.repeat(64), 'u1', 'w1', Date.now() + 3600_000);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('e'.repeat(64), 'u1', 'w1', Date.now() - 1000);
  for (const project of projects) {
    const doc = document(project.id, project.assetIds);
    db.prepare('INSERT INTO projects VALUES (?,?,?)').run(project.id, project.workspaceId, JSON.stringify(doc));
    // Same per-workspace media root as apps/saas-api/server.mjs.
    const dir = path.join(dataRoot, 'media', project.workspaceId, '.remix', project.id);
    await mkdir(dir, { recursive: true });
    for (const assetId of project.assetIds) await writeFile(path.join(dir, assetId), assetBytes(assetId));
  }
  db.close();
}

let clean, corrupted;
try {
  await buildSource();
  await verify('本地夹具使用与 SaaS 服务器相同的 SQLite DDL 与素材布局', async () => {
    const db = new DatabaseSync(path.join(dataRoot, 'saas.sqlite'), { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, projects.length);
    db.close();
  });

  clean = await migrate({ dataRoot, out });
  await verify('迁移成功并核对每个素材的大小与 SHA-256', async () => {
    assert.equal(clean.ok, true, JSON.stringify(clean.problems));
    assert.equal(clean.tables.users, users.length);
    assert.equal(clean.tables.workspaces, workspaces.length);
    assert.equal(clean.tables.memberships, 2);
    assert.equal(clean.tables.projects, projects.length);
    assert.equal(clean.assets.referenced, 4);
    assert.equal(clean.assets.verified, 4);
    assert.equal(clean.r2Keys, 4);
  });

  await verify('过期会话不会被迁移，有效会话保留', async () => {
    const sql = await readFile(path.join(out, 'data.sql'), 'utf8');
    assert.ok(sql.includes('f'.repeat(64)), '有效会话应写入');
    assert.ok(!sql.includes('e'.repeat(64)), '过期会话不应写入');
    assert.equal(clean.tables.sessions, 2, '源表仍报告两条，便于核对');
  });

  await verify('R2 清单使用带空间前缀的键并记录真实哈希', async () => {
    const manifest = JSON.parse(await readFile(path.join(out, 'r2-manifest.json'), 'utf8'));
    assert.equal(manifest.objects.length, 4);
    for (const object of manifest.objects) {
      assert.match(object.key, /^workspaces\/w[12]\/projects\/remix_[a-f0-9-]{36}\/assets\/asset_[a-z]+$/);
      assert.equal(object.sha256, digest(assetBytes(path.basename(object.key))));
    }
    assert.equal(manifest.objects[0].localPath.startsWith('media/'), true);
  });

  await verify('素材缺失时迁移拒绝通过并列出问题', async () => {
    const missing = path.join(dataRoot, 'media', projects[1].workspaceId, '.remix', projects[1].id, projects[1].assetIds[0]);
    const saved = await readFile(missing);
    await rm(missing);
    corrupted = await migrate({ dataRoot, out: path.join(output, 'export-broken') });
    assert.equal(corrupted.ok, false);
    assert.equal(corrupted.assets.missing.length, 1);
    assert.equal(corrupted.assets.missing[0].project, projects[1].id);
    await writeFile(missing, saved);
  });

  await verify('超过 D1 单项目预算的工程被报告而不是直接迁移', async () => {
    const oversized = 'remix_44444444-4444-4444-8444-444444444444';
    const write = new DatabaseSync(path.join(dataRoot, 'saas.sqlite'));
    const doc = document(oversized, []);
    doc.blob = 'x'.repeat(1536 * 1024 + 32);
    write.prepare('INSERT INTO projects VALUES (?,?,?)').run(oversized, 'w1', JSON.stringify(doc));
    write.close();
    const result = await migrate({ dataRoot, out: path.join(output, 'export-oversize') });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(text => text.includes(oversized)), JSON.stringify(result.problems));
    const sql = await readFile(path.join(output, 'export-oversize', 'data.sql'), 'utf8');
    assert.ok(!sql.includes(oversized), '超限工程不应写入 data.sql');
    const cleanup = new DatabaseSync(path.join(dataRoot, 'saas.sqlite'));
    cleanup.prepare('DELETE FROM projects WHERE id=?').run(oversized);
    cleanup.close();
  });

  const schema = (await readFile(path.join(root, 'packages/cloudflare-storage/schema.sql'), 'utf8')).replace(/^--.*$/gm, '');
  const data = (await readFile(path.join(out, 'data.sql'), 'utf8')).split('\n').filter(line => line.startsWith('INSERT'));
  const runtime = new Miniflare({
    modules: true, script: 'export default { fetch(){ return new Response("ok") } }', compatibilityDate: '2026-07-30',
    d1Databases: ['DB'], d1Persist: path.join(output, 'd1'), r2Buckets: ['MEDIA'], r2Persist: path.join(output, 'r2'),
    log: new Log(LogLevel.WARN),
  });
  try {
    const db = await runtime.getD1Database('DB');
    for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    await verify('完整 schema 可在 D1 建表（账号、空间、成员、会话、项目）', async () => {
      const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      for (const name of ['users', 'workspaces', 'memberships', 'sessions', 'remix_projects']) {
        assert.ok(tables.results.some(row => row.name === name), `缺少表 ${name}`);
      }
    });

    for (const statement of data) await db.prepare(statement).run();
    await verify('迁移后的数据行数与源一致，项目文档与版本哈希一致', async () => {
      for (const [table, expected] of [['users', users.length], ['workspaces', workspaces.length], ['memberships', 2], ['remix_projects', projects.length]]) {
        const row = await db.prepare(`SELECT count(*) AS n FROM ${table}`).first();
        assert.equal(row.n, expected, table);
      }
      for (const project of projects) {
        const row = await db.prepare('SELECT workspace_id,document,revision FROM remix_projects WHERE id=?').bind(project.id).first();
        assert.equal(row.workspace_id, project.workspaceId);
        const source = JSON.stringify(document(project.id, project.assetIds));
        assert.equal(row.document, source, '文档内容必须逐字一致');
        assert.equal(row.revision, await projectRevision(JSON.parse(source)));
      }
      const sessions = await db.prepare('SELECT token_hash FROM sessions').all();
      assert.deepEqual(sessions.results.map(row => row.token_hash), ['f'.repeat(64)]);
    });

    const manifest = JSON.parse(await readFile(path.join(out, 'r2-manifest.json'), 'utf8'));
    await verify('R2 对象写入后可原样取回，哈希与清单一致', async () => {
      const bucket = await runtime.getR2Bucket('MEDIA');
      for (const object of manifest.objects) {
        await bucket.put(object.key, assetBytes(path.basename(object.key)), { httpMetadata: { contentType: object.mime } });
      }
      for (const object of manifest.objects) {
        const stored = await bucket.get(object.key);
        assert.ok(stored, object.key);
        const bytes = Buffer.from(await stored.arrayBuffer());
        assert.equal(digest(bytes), object.sha256, object.key);
        assert.equal(bytes.length, object.bytes);
      }
    });
  } finally {
    await runtime.dispose();
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)).catch(() => {});
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, output, error: report.error }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
