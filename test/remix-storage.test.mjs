import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalRepository } from '../packages/remix/local-repository.mjs';
import { projectRevision } from '../packages/remix/revision.mjs';
import { openStore } from '../packages/saas/store.mjs';
import { createRemixManager } from '../packages/remix/index.mjs';

async function verifyConcurrentSave(repository) {
  const original = { id: 'remix_' + randomUUID(), title: '原方案', assets: [], plan: { rows: [] }, batches: [] };
  const revision = await projectRevision(original);
  assert.equal(revision, createHash('sha256').update(JSON.stringify(original)).digest('hex'));
  await repository.save(original, { expectedRevision: null });
  await assert.rejects(repository.save({ ...original, title: '覆盖创建' }, { expectedRevision: null }), { status: 409 });
  const results = await Promise.allSettled(['方案 A', '方案 B'].map(title => repository.save({ ...original, title }, { expectedRevision: revision })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.ok(['方案 A', '方案 B'].includes((await repository.read(original.id)).title));
  await assert.rejects(repository.save(original, { expectedRevision: undefined }), { status: 400 });
  return original;
}

test('本地 JSON 存储版本与旧哈希兼容，两个管理器同时保存只有一个成功', async () => {
  const root = await mkdtemp('G:/DevCache/Temp/pi-agent-hypite/storage-json-');
  const first = createLocalRepository(root), second = createLocalRepository(root);
  const p = await verifyConcurrentSave(first);
  const current = await second.read(p.id), revision = await projectRevision(current);
  const results = await Promise.allSettled([
    first.save({ ...current, title: 'manager A' }, { expectedRevision: revision }),
    second.save({ ...current, title: 'manager B' }, { expectedRevision: revision }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});

test('SQLite 原子保存拒绝覆盖、过期版本和跨空间写入，重启仍保留胜出版本', async () => {
  const root = await mkdtemp('G:/DevCache/Temp/pi-agent-hypite/storage-sqlite-');
  let store = await openStore(root);
  try {
    const token = await store.register({ email: 'a@storage.test', name: 'A', password: 'storage-test-password' });
    const workspace = store.identify(token).workspace_id, repo = store.repository(workspace);
    const p = await verifyConcurrentSave(repo);
    const otherToken = await store.register({ email: 'b@storage.test', name: 'B', password: 'storage-test-password' });
    const other = store.repository(store.identify(otherToken).workspace_id);
    await assert.rejects(other.save(p, { expectedRevision: null }), { status: 409 });
    await assert.rejects(other.save(p, { expectedRevision: await projectRevision(p) }), { status: 404 });
    const current = await repo.read(p.id);
    store.close(); store = await openStore(root);
    assert.deepEqual(await store.repository(workspace).read(p.id), current);
  } finally { store.close(); }
});

test('上传字节写入后元数据保存失败，可用原会话重试且只登记一次', async () => {
  const root = await mkdtemp('G:/DevCache/Temp/pi-agent-hypite/storage-upload-');
  const repository = createLocalRepository(root + '/.remix');
  let failNextAssetSave = true;
  const manager = createRemixManager({ dataRoot: root, remixMediaBase: '/api/media', remixRepository: {
    ...repository,
    async save(document, options) {
      if (document.assets.length && failNextAssetSave) { failNextAssetSave = false; throw Object.assign(new Error('temporary storage failure'), { status: 503 }); }
      return repository.save(document, options);
    },
  } });
  try {
    const project = await manager.create({ title: '上传恢复', requestId: randomUUID() });
    const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    const upload = await manager.begin(project.id, { name: 'synthetic.mp4', size: bytes.length });
    await manager.chunk(project.id, { ...upload, offset: 0, data: bytes.toString('base64') });
    await assert.rejects(manager.finish(project.id, upload), { status: 503 });
    assert.equal((await manager.show(project.id)).assets.length, 0);
    const completed = await manager.finish(project.id, upload);
    const shown = await manager.show(project.id);
    assert.equal(shown.assets.length, 1); assert.equal(shown.assets[0].available, true);
    assert.deepEqual(await readFile((await manager.media(project.id, completed.assetId)).file), bytes);
  } finally { await manager.shutdown(); }
});
