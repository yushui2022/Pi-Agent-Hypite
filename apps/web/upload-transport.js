// One upload path for both backends.
//
// Cloud (Workers) has no chunked upload route and must not receive media through the Worker,
// so it offers /api/uploads: ask for a signed URL, PUT the file straight to R2, then confirm.
// The local Node server still only knows begin/chunk/finish, so that remains the fallback.
// The capability probe is the authorize call itself: 404/405 means "this backend cannot do it".
export async function uploadFile({ projectId, file, post, onProgress = () => {} }) {
  const direct = await tryDirect({ projectId, file, onProgress });
  if (direct) return direct;
  return chunked({ file, post, onProgress });
}

async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function tryDirect({ projectId, file, onProgress }) {
  let upload;
  try {
    const response = await fetch('/api/uploads', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, name: file.name, mime: file.type || 'video/mp4', size: file.size, sha256: await sha256Hex(file) }),
    });
    // 404/405/501: this backend has no direct-upload route, so fall back instead of failing.
    if ([404, 405, 501].includes(response.status)) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '上传申请失败');
    upload = data.upload;
  } catch (error) {
    // A missing route can also surface as a network/type error before any response.
    if (error instanceof TypeError) return null;
    throw error;
  }

  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
  if (!put.ok) throw new Error(`直传存储失败（${put.status}），请检查存储桶的 CORS 设置`);
  onProgress(file.size, file.size);

  const complete = await fetch(`/api/uploads/${upload.uploadId}/complete`, { method: 'POST', credentials: 'same-origin' });
  const done = await complete.json().catch(() => ({}));
  if (!complete.ok) throw new Error(done.error || '上传确认失败');
  return { assetId: done.assetId, duplicate: done.duplicate === true, direct: true };
}

async function chunked({ file, post, onProgress }) {
  let uploadId;
  try {
    uploadId = (await post('begin', { name: file.name, size: file.size })).uploadId;
    for (let offset = 0; offset < file.size; offset += 32768) {
      const bytes = new Uint8Array(await file.slice(offset, offset + 32768).arrayBuffer());
      let raw = '';
      for (const byte of bytes) raw += String.fromCharCode(byte);
      await post('chunk', { uploadId, offset, data: btoa(raw) });
      onProgress(Math.min(offset + 32768, file.size), file.size);
    }
    const finished = await post('finish', { uploadId });
    uploadId = null;
    return { ...finished, direct: false };
  } catch (error) {
    if (uploadId) await post('abort', { uploadId }).catch(() => {});
    throw error;
  }
}
