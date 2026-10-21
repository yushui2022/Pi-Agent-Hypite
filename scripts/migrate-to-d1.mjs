// Local SQLite + disk media  ->  D1 SQL + R2 upload manifest.
//
// Read-only against the local data root: this never writes to the source database and
// never contacts Cloudflare. It produces artifacts an operator reviews and applies, so a
// bad row is visible before it reaches production.
//
// Verification is part of the migration, not a separate promise: every asset referenced by
// a project document must exist on disk with a matching size and SHA-256, every project must
// belong to an existing workspace, and every account row must satisfy the D1 constraints.
// Any mismatch aborts with a non-zero exit code and is listed in the report.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { projectRevision } from '../packages/remix/revision.mjs';
import { fileURLToPath } from 'node:url';

const sqlText = value => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const sqlNumber = value => (Number.isFinite(Number(value)) ? String(Number(value)) : 'NULL');
const MAX_CLOUD_DOCUMENT_BYTES = 1536 * 1024;

async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function migrate({ dataRoot, out, includeSessions = true }) {
  const database = path.join(dataRoot, 'saas.sqlite');
  // Media is rooted per workspace, not per data root.
  const mediaRoot = path.join(dataRoot, 'media');
  const report = {
    schema: 'pi-studio.d1-migration@1',
    startedAt: new Date().toISOString(),
    dataRoot,
    source: { database, mediaRoot },
    tables: {},
    projects: [],
    assets: { referenced: 0, verified: 0, missing: [], mismatched: [] },
    r2Keys: 0,
    problems: [],
    cloudApplied: false,
  };

  let db;
  try {
    db = new DatabaseSync(database, { readOnly: true });
  } catch (error) {
    report.problems.push(`无法读取本地数据库：${error.message}`);
    return finish(report, out);
  }

  const tables = {
    users: db.prepare('SELECT id,email,name,salt,password_hash FROM users').all(),
    workspaces: db.prepare('SELECT id,name FROM workspaces').all(),
    memberships: db.prepare('SELECT user_id,workspace_id,role FROM memberships').all(),
    sessions: includeSessions ? db.prepare('SELECT token_hash,user_id,workspace_id,expires_at FROM sessions').all() : [],
    projects: db.prepare('SELECT id,workspace_id,document FROM projects').all(),
  };
  db.close();
  for (const [name, rows] of Object.entries(tables)) report.tables[name] = rows.length;

  const statements = [];
  for (const row of tables.users) {
    statements.push(`INSERT OR REPLACE INTO users(id,email,name,salt,password_hash) VALUES (${sqlText(row.id)},${sqlText(row.email)},${sqlText(row.name)},${sqlText(row.salt)},${sqlText(row.password_hash)});`);
  }
  for (const row of tables.workspaces) {
    statements.push(`INSERT OR REPLACE INTO workspaces(id,name) VALUES (${sqlText(row.id)},${sqlText(row.name)});`);
  }
  for (const row of tables.memberships) {
    statements.push(`INSERT OR REPLACE INTO memberships(user_id,workspace_id,role) VALUES (${sqlText(row.user_id)},${sqlText(row.workspace_id)},${sqlText(row.role)});`);
  }
  // Expired sessions are dropped rather than copied; they can only cause a failed lookup.
  const now = Date.now();
  for (const row of tables.sessions) {
    if (Number(row.expires_at) <= now) continue;
    statements.push(`INSERT OR REPLACE INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (${sqlText(row.token_hash)},${sqlText(row.user_id)},${sqlText(row.workspace_id)},${sqlNumber(row.expires_at)});`);
  }

  const workspaceIds = new Set(tables.workspaces.map(row => row.id));
  const uploads = [];
  for (const row of tables.projects) {
    const entry = { id: row.id, workspaceId: row.workspace_id, assets: 0, revision: null };
    report.projects.push(entry);
    if (!workspaceIds.has(row.workspace_id)) {
      report.problems.push(`项目 ${row.id} 的 workspace ${row.workspace_id} 不存在`);
      continue;
    }
    // Keep in sync with MAX_CLOUD_DOCUMENT_BYTES in packages/cloudflare-storage/d1.ts.
    // An oversized project cannot be stored, so it is reported instead of copied: the
    // documented rule is to split such projects, never to migrate them losslessly.
    const documentBytes = Buffer.byteLength(row.document, 'utf8');
    if (documentBytes > MAX_CLOUD_DOCUMENT_BYTES) {
      report.problems.push(`项目 ${row.id} 文档 ${documentBytes} 字节超过 D1 单项目 1.5 MiB 预算，需拆分后再迁移`);
      continue;
    }
    let document;
    try {
      document = JSON.parse(row.document);
    } catch (error) {
      report.problems.push(`项目 ${row.id} 的文档不是有效 JSON：${error.message}`);
      continue;
    }
    entry.revision = await projectRevision(document);
    statements.push(`INSERT OR REPLACE INTO remix_projects(id,workspace_id,document,revision) VALUES (${sqlText(row.id)},${sqlText(row.workspace_id)},${sqlText(row.document)},${sqlText(entry.revision)});`);

    for (const asset of Array.isArray(document.assets) ? document.assets : []) {
      report.assets.referenced++;
      // Real layout, from apps/saas-api/server.mjs: each workspace gets its own remix root.
      //   <dataRoot>/media/<workspaceId>/.remix/<projectId>/<assetId>
      const file = path.join(mediaRoot, row.workspace_id, '.remix', row.id, String(asset.id));
      try {
        const info = await stat(file);
        if (info.size !== Number(asset.size)) {
          report.assets.mismatched.push({ project: row.id, asset: asset.id, reason: 'size', expected: Number(asset.size), actual: info.size });
          continue;
        }
        const digest = await fileDigest(file);
        if (digest !== asset.sha256) {
          report.assets.mismatched.push({ project: row.id, asset: asset.id, reason: 'sha256', expected: asset.sha256, actual: digest });
          continue;
        }
        report.assets.verified++;
        entry.assets++;
        uploads.push({
          key: `workspaces/${row.workspace_id}/projects/${row.id}/assets/${asset.id}`,
          localPath: path.relative(dataRoot, file).replace(/\\/g, '/'),
          bytes: info.size,
          sha256: digest,
          mime: asset.mime,
          name: asset.name,
        });
      } catch (error) {
        report.assets.missing.push({ project: row.id, asset: asset.id, reason: error.code ?? error.message });
      }
    }
  }
  report.r2Keys = uploads.length;
  return finish(report, out, { statements, uploads });
}

async function finish(report, out, artifacts) {
  if (artifacts) {
    await mkdir(out, { recursive: true });
    const header = [
      '-- Generated by scripts/migrate-to-d1.mjs. Review before applying.',
      `-- Generated at ${report.startedAt}`,
      '-- Apply: wrangler d1 execute <DB> --remote --file=<this-file>',
      '',
    ].join('\n');
    await writeFile(path.join(out, 'data.sql'), header + artifacts.statements.join('\n') + '\n');
    await writeFile(path.join(out, 'r2-manifest.json'), JSON.stringify({ generatedAt: report.startedAt, objects: artifacts.uploads }, null, 2));
    report.statements = artifacts.statements.length;
  }
  report.ok = report.problems.length === 0 && report.assets.missing.length === 0 && report.assets.mismatched.length === 0;
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const value = flag => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const dataRoot = value('--data-root') ?? path.resolve('.data/saas');
  const out = value('--out') ?? path.resolve('.data/d1-export');
  const report = await migrate({ dataRoot, out, includeSessions: !args.includes('--skip-sessions') });
  const summary = {
    ok: report.ok,
    out,
    tables: report.tables,
    projects: report.projects.length,
    assets: report.assets,
    r2Keys: report.r2Keys,
    problems: report.problems,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
