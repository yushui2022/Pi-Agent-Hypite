import { assertProjectId, assertRevision, fault, projectRevision } from '../remix/revision.mjs';
import { assertWorkspaceId } from './scope';
import type { ProjectDocument, ProjectRepository } from './contracts';

// Leave space below D1's 2 MB string/BLOB/row limit for keys and other columns.
export const MAX_CLOUD_DOCUMENT_BYTES = 1536 * 1024;

export function createD1Repository(db: D1Database, workspaceId: string): ProjectRepository {
  assertWorkspaceId(workspaceId);
  return {
    async summaries() {
      // One query, without downloading every full project just to render its list card.
      const result = await db.prepare(`SELECT id,
        json_extract(document,'$.title') AS title,
        json_extract(document,'$.createdAt') AS createdAt,
        json_array_length(document,'$.assets') AS assets,
        json_array_length(document,'$.batches') AS batches
        FROM remix_projects WHERE workspace_id=?`).bind(workspaceId).all<{
          id: string; title: string; createdAt: string; assets: number; batches: number;
        }>();
      return result.results;
    },
    async ids() {
      const result = await db.prepare('SELECT id FROM remix_projects WHERE workspace_id=? ORDER BY id').bind(workspaceId).all<{ id: string }>();
      return result.results.map(row => row.id);
    },
    async read(id) {
      assertProjectId(id);
      const row = await db.prepare('SELECT document FROM remix_projects WHERE id=? AND workspace_id=?').bind(id, workspaceId).first<{ document: string }>();
      if (!row) throw fault('项目不存在', 404, 'ENOENT');
      return JSON.parse(row.document) as ProjectDocument;
    },
    async save(document, { expectedRevision }) {
      assertProjectId(document.id);
      assertRevision(expectedRevision);
      const serialized = JSON.stringify(document);
      if (new TextEncoder().encode(serialized).length > MAX_CLOUD_DOCUMENT_BYTES) {
        throw fault('项目超过云端单项目容量，请拆分项目后再保存', 413);
      }
      const revision = await projectRevision(document);
      if (expectedRevision === null) {
        // The quota check and insert are one statement, also under concurrent requests.
        const result = await db.prepare(`INSERT INTO remix_projects(id,workspace_id,document,revision)
          SELECT ?,?,?,? WHERE (SELECT count(*) FROM remix_projects WHERE workspace_id=?)<100
          ON CONFLICT(id) DO NOTHING`).bind(document.id, workspaceId, serialized, revision, workspaceId).run();
        if (result.meta.changes) return;
        const collision = await db.prepare('SELECT id FROM remix_projects WHERE id=?').bind(document.id).first();
        if (collision) throw fault('项目编号不可使用', 409);
        throw fault('当前每空间最多 100 个项目');
      }
      const result = await db.prepare(`UPDATE remix_projects SET document=?,revision=?
        WHERE id=? AND workspace_id=? AND revision=?`).bind(serialized, revision, document.id, workspaceId, expectedRevision).run();
      if (result.meta.changes) return;
      const present = await db.prepare('SELECT id FROM remix_projects WHERE id=? AND workspace_id=?').bind(document.id, workspaceId).first();
      if (!present) throw fault('项目不存在', 404, 'ENOENT');
      throw fault('项目已更新，请重新打开后重试', 409);
    },
  };
}
