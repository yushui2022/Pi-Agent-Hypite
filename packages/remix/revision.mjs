// The compact JSON representation is also used by existing local project revisions.
export async function projectRevision(document) {
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function fault(message, status = 400, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

export function assertProjectId(id) {
  if (typeof id !== 'string' || !/^remix_[a-f0-9-]{36}$/.test(id)) throw fault('项目编号无效');
}

export function assertRevision(revision) {
  if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))) {
    throw fault('保存需要明确的项目版本');
  }
}
