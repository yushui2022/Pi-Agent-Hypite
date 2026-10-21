import { assertProjectId, fault } from '../remix/revision.mjs';
import { assertWorkspaceId } from './scope';
import type { AssetRecord } from './contracts';

function matches(object: R2Object, asset: AssetRecord): boolean {
  const hash = object.checksums.sha256;
  const actual = hash && Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return object.size === asset.size && actual === asset.sha256;
}

/** Reads private objects. Callers must first resolve the asset through the scoped repository.
 * Upload authorization/finalization will be a separate API; unverified objects stay unavailable.
 */
export function createR2Media(bucket: R2Bucket, workspaceId: string) {
  assertWorkspaceId(workspaceId);
  function key(projectId: string, asset: AssetRecord): string {
    assertProjectId(projectId);
    if (!/^asset_[a-f0-9-]{36}$/.test(asset.id)) throw fault('素材编号无效');
    return `workspaces/${workspaceId}/projects/${projectId}/assets/${asset.id}`;
  }
  return {
    key,
    url: (projectId: string, asset: AssetRecord) => { key(projectId, asset); return `/api/media/${projectId}/${asset.id}`; },
    async available(projectId: string, asset: AssetRecord): Promise<boolean> {
      const object = await bucket.head(key(projectId, asset));
      return object !== null && matches(object, asset);
    },
    async respond(projectId: string, asset: AssetRecord, request: Request): Promise<Response> {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      const objectKey = key(projectId, asset), head = await bucket.head(objectKey);
      if (!head) throw fault('素材文件不存在', 404);
      if (!matches(head, asset)) throw fault('素材文件尚未通过完整性确认', 409);
      let start = 0, end = head.size - 1, status = 200;
      const range = request.headers.get('Range');
      if (range) {
        const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
        const invalid = () => new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}`, 'Cache-Control': 'private, no-store' } });
        if (!parts || (!parts[1] && !parts[2])) return invalid();
        if ([parts[1], parts[2]].some(value => value && !Number.isSafeInteger(Number(value)))) return invalid();
        if (!parts[1]) start = Math.max(0, head.size - Number(parts[2]));
        else start = Number(parts[1]);
        if (parts[1] && parts[2]) end = Math.min(end, Number(parts[2]));
        if (start > end || start >= head.size) return invalid();
        status = 206;
      }
      const headers = new Headers({
        'Content-Type': asset.mime, 'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store', ETag: head.httpEtag,
        ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${head.size}` } : {}),
      });
      if (request.method === 'HEAD') return new Response(null, { status, headers });
      // Never return bytes from an object changed between metadata lookup and streaming.
      const body = await bucket.get(objectKey, { onlyIf: { etagMatches: head.etag }, range: { offset: start, length: end - start + 1 } });
      if (!body) throw fault('素材文件不存在', 404);
      if (!('body' in body) || !matches(body, asset)) throw fault('素材文件已变化，请重新加载', 409);
      return new Response(body.body, { status, headers });
    },
  };
}
