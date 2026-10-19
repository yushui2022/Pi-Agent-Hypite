import test from 'node:test';
import assert from 'node:assert/strict';
import { localRuntime, localToken } from '../scripts/local-runtime.mjs';

test('Media experiment rejects unauthorized, unbounded and unconfigured operations in workerd', async () => {
  const runtime = localRuntime('media');
  const invoke = body => runtime.dispatchFetch('https://p0.invalid/run', { method: 'POST', headers: { authorization: `Bearer ${localToken}` }, body: JSON.stringify(body) });
  try {
    assert.equal((await runtime.dispatchFetch('https://p0.invalid/health')).status, 401);
    assert.equal((await invoke({ id: '../escape', operation: 'version' })).status, 400);
    assert.equal((await invoke({ id: 'test', operation: 'shell' })).status, 400);
    assert.equal((await invoke({ id: 'test', operation: 'frame' })).status, 503);
    assert.equal((await invoke(null)).status, 400);
    assert.equal((await invoke({ id: 'test', operation: 'normalize-1', caption: 'a\nb\nc' })).status, 400);
    assert.equal((await invoke({ id: 'test', operation: 'normalize-1', caption: '商品🙂' })).status, 422);
    assert.equal((await invoke({ id: 'test', operation: 'normalize-1', caption: '一'.repeat(16) })).status, 422);
    assert.equal((await invoke({ id: 'test', operation: 'normalize-1', caption: 'W'.repeat(16) })).status, 422);
    assert.equal((await invoke({ id: 'test', operation: 'normalize-1', caption: '新品\u202e上市' })).status, 422);
    assert.equal((await invoke({ id: 'test', operation: 'normalize-1', caption: '新品\u200b上市' })).status, 422);
    assert.equal((await invoke({ id: 'test', operation: 'normalize-1', caption: '商品', startSeconds: -1 })).status, 400);
    assert.equal((await invoke({ id: 'test', operation: 'version', padding: 'x'.repeat(9000) })).status, 413);
    const upload = await runtime.dispatchFetch('https://p0.invalid/fixtures/shot-1.mp4', {
      method: 'PUT', headers: { authorization: `Bearer ${localToken}` }, body: new Uint8Array(8 * 1024 * 1024 + 1),
    });
    assert.equal(upload.status, 413);
    const response = await invoke({ id: 'test', operation: 'version' });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.kind, 'wasm');
    assert.ok(result.heapInitial <= 96 * 1024 * 1024);
    assert.ok(result.logs.some(line => line.includes('--disable-pthreads')));
  } finally { await runtime.dispose(); }
});
