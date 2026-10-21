// Upload authorization and completion for R2 direct uploads.
//
// The browser never proxies bytes through the Worker. It asks for a short-lived signed URL,
// PUTs straight to R2, then asks the Worker to confirm. Trust boundaries:
//   - The object key is generated here from the session's workspace, never accepted from input.
//   - The checksum travels as a signed header, so the client cannot drop it.
//   - Confirmation compares what R2 actually holds (size + native checksum) with the request;
//     nothing the browser claims after the fact is believed.
//   - A failed confirmation deletes the object, so junk does not accumulate.
import { fault } from '../remix/revision.mjs';
import { assertWorkspaceId } from './scope';
import { presignS3Url } from './sigv4';

export const MAX_UPLOAD_BYTES = 100_000_000;
export const UPLOAD_TTL_MS = 15 * 60 * 1000;

/** Only formats the rest of the pipeline claims to handle. Everything else is refused. */
export const ALLOWED_MIME = new Map<string, string>([
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
]);

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface AuthorizeInput {
  projectId?: unknown;
  name?: unknown;
  mime?: unknown;
  size?: unknown;
  sha256?: unknown;
}

export interface AuthorizedUpload {
  uploadId: string;
  assetId: string;
  key: string;
  url: string;
  /** Headers the browser must send or the signature will not match. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface CompletedAsset {
  assetId: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

interface UploadRow {
  id: string; project_id: string; asset_id: string; object_key: string; name: string;
  mime: string; size: number; sha256: string; state: string; expires_at: number; created_at: number;
}

const PROJECT = /^remix_[a-f0-9-]{36}$/;
const HEX64 = /^[a-f0-9]{64}$/;

function hexToBase64(hex: string): string {
  let binary = '';
  for (let index = 0; index < hex.length; index += 2) binary += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
  return btoa(binary);
}

function checksumHex(value: ArrayBuffer | undefined): string {
  // R2 exposes the native checksum as an ArrayBuffer, not a hex string (see r2.ts).
  return value ? Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('') : '';
}

export async function authorizeUpload(
  db: D1Database, workspaceId: string, input: AuthorizeInput, s3: S3Config, now = new Date(),
): Promise<AuthorizedUpload> {
  assertWorkspaceId(workspaceId);
  const projectId = typeof input.projectId === 'string' ? input.projectId : '';
  if (!PROJECT.test(projectId)) throw fault('项目编号无效', 400);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 240) throw fault('文件名无效', 400);
  const mime = typeof input.mime === 'string' ? input.mime.toLowerCase() : '';
  if (!ALLOWED_MIME.has(mime)) throw fault('不支持的素材类型', 415);
  const size = Number(input.size);
  if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) throw fault(`单个文件需为 1 字节至 ${MAX_UPLOAD_BYTES / 1_000_000} MB`, 413);
  const sha256 = typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : '';
  if (!HEX64.test(sha256)) throw fault('缺少有效的文件校验和', 400);

  const uploadId = `upload_${crypto.randomUUID()}`;
  const assetId = `asset_${crypto.randomUUID()}`;
  const key = `workspaces/${workspaceId}/projects/${projectId}/assets/${assetId}`;
  const expiresAt = now.getTime() + UPLOAD_TTL_MS;

  const signed = await presignS3Url({
    method: 'PUT',
    endpoint: s3.endpoint,
    bucket: s3.bucket,
    key,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
    region: s3.region ?? 'auto',
    expiresSeconds: Math.floor(UPLOAD_TTL_MS / 1000),
    now,
    // Signed, therefore mandatory: R2 stores this checksum and refuses a mismatching body.
    extraHeaders: { 'x-amz-checksum-sha256': hexToBase64(sha256) },
  });

  await db.prepare(`INSERT INTO uploads(id,workspace_id,project_id,asset_id,object_key,name,mime,size,sha256,state,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(uploadId, workspaceId, projectId, assetId, key, name, mime, size, sha256, 'pending', expiresAt, now.getTime()).run();

  return { uploadId, assetId, key, url: signed.url, headers: signed.headers, expiresAt: new Date(expiresAt).toISOString() };
}

async function failUpload(db: D1Database, bucket: R2Bucket, row: UploadRow, message: string, status: number): Promise<never> {
  await db.prepare("UPDATE uploads SET state='failed' WHERE id=?").bind(row.id).run();
  // A rejected object must not linger: it was never registered as an asset.
  await bucket.delete(row.object_key).catch(() => {});
  throw fault(message, status);
}

export async function completeUpload(
  db: D1Database, bucket: R2Bucket, workspaceId: string, uploadId: unknown, now = new Date(),
): Promise<CompletedAsset> {
  assertWorkspaceId(workspaceId);
  if (typeof uploadId !== 'string' || !/^upload_[a-f0-9-]{36}$/.test(uploadId)) throw fault('上传编号无效', 400);
  // Scoped by workspace: another tenant's upload id answers like a missing one.
  const row = await db.prepare('SELECT * FROM uploads WHERE id=? AND workspace_id=?').bind(uploadId, workspaceId).first<UploadRow>();
  if (!row) throw fault('上传申请不存在', 404);
  if (row.state === 'complete') throw fault('该上传已经确认过', 409);
  if (row.state === 'failed') throw fault('该上传已作废，请重新申请', 409);
  if (Number(row.expires_at) <= now.getTime()) return await failUpload(db, bucket, row, '上传申请已过期，请重新申请', 409);

  const object = await bucket.head(row.object_key);
  if (!object) return await failUpload(db, bucket, row, '尚未收到文件，请先完成上传', 409);
  if (Number(object.size) !== Number(row.size)) {
    return await failUpload(db, bucket, row, `文件大小为 ${object.size} 字节，与申请时的 ${row.size} 不一致`, 422);
  }
  const checksum = checksumHex(object.checksums?.sha256 as ArrayBuffer | undefined);
  // Without a storage-side checksum there is nothing to compare against, so the object is unusable.
  if (!checksum) return await failUpload(db, bucket, row, '存储未提供校验和，无法确认文件完整性', 422);
  if (checksum !== row.sha256) return await failUpload(db, bucket, row, '文件校验和不匹配，已丢弃', 422);

  await db.prepare("UPDATE uploads SET state='complete' WHERE id=? AND workspace_id=?").bind(uploadId, workspaceId).run();
  return {
    assetId: row.asset_id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    sha256: row.sha256,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}
