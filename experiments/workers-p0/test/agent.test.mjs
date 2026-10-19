import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { output } from '../scripts/paths.mjs';
import { localRuntime, localToken } from '../scripts/local-runtime.mjs';

test('Pi runs in workerd: HTTP envelope, validation, allowlist, persisted continuation and idempotence', async () => {
  await mkdir(output, { recursive: true });
  const state = await mkdtemp(path.join(output, 'pi-test-'));
  const requests = [];
  const extra = {
    bindings: { P0_TOKEN: localToken, P0_MODEL_MODE: 'fixture' },
    serviceBindings: { MODEL_TRANSPORT: async request => {
      const body = await request.json();
      requests.push({ requestId: request.headers.get('idempotency-key'), body });
      assert.deepEqual(body.tools.map(t => t.function.name), ['inspect_asset']);
      assert.equal(body.stream, false);
      const continued = body.messages.some(m => m.role === 'tool');
      const scenario = body.messages.find(m => m.role === 'user').content.split(': ').at(-1);
      const message = continued ? { content: 'Fixture inspection complete.' } : { tool_calls: [{ id: 'call-1', type: 'function', function: {
        name: scenario === 'unknown' ? 'shell' : 'inspect_asset',
        arguments: JSON.stringify(scenario === 'invalid' ? { assetId: { nested: 'invalid' }, shell: 'forbidden' } : { assetId: scenario === 'denied' ? 'another-tenant-asset' : 'fixture-shot-1' }),
      } }] };
      return Response.json({ choices: [{ message, finish_reason: continued ? 'stop' : 'tool_calls' }] });
    } },
  };
  let runtime = localRuntime('agent', state, extra);
  const invoke = (route, body, token = localToken) => runtime.dispatchFetch(`https://p0.invalid${route}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const results = [];
  try {
    assert.equal((await invoke('/start', { id: 'forbidden' }, 'wrong')).status, 401);
    const firstResponse = await invoke('/start', { id: 'restart-case' });
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200, JSON.stringify(first));
    assert.equal(first.state, 'awaiting-continuation', JSON.stringify(first));
    assert.equal(first.toolExecutions, 1);
    results.push(first);
    await invoke('/start', { id: 'restart-case' });
    assert.equal(requests.length, 1, 'duplicate start must not call model');
    await runtime.dispose();
    runtime = localRuntime('agent', state, extra);
    const resumed = await (await invoke('/resume', { id: 'restart-case' })).json();
    assert.equal(resumed.state, 'complete', JSON.stringify(resumed));
    assert.equal(resumed.toolExecutions, 1, 'restore must not execute completed tool again');
    results.push(resumed);
    await invoke('/resume', { id: 'restart-case' });
    assert.equal(requests.length, 2, 'duplicate resume must not call model');
    for (const scenario of ['invalid', 'unknown', 'denied']) {
      const response = await invoke('/start', { id: scenario, scenario });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.state, 'failed', JSON.stringify(result));
      assert.equal(result.toolExecutions, 0);
      assert.ok(result.messages.some(m => m.role === 'toolResult' && m.isError));
      assert.equal((await invoke('/resume', { id: scenario, scenario })).status, 409);
      results.push(result);
    }
    const bucket = await runtime.getR2Bucket('ARTIFACTS');
    await bucket.put('pi/uncertain/start-intent.json', '{}');
    assert.equal((await invoke('/start', { id: 'uncertain' })).status, 409);
    assert.equal((await invoke('/resume', { id: 'missing' })).status, 409);
    await writeFile(path.join(state, 'evidence.json'), JSON.stringify({ environment: 'local-workerd', liveModelAccepted: false, requests, results }, null, 2));
    console.log(`Pi evidence: ${state}`);
  } finally { await runtime.dispose(); }
});

test('Pi without configured transport fails closed', async () => {
  const runtime = localRuntime('agent');
  try {
    const result = await runtime.dispatchFetch('https://p0.invalid/start', { method: 'POST', headers: { authorization: `Bearer ${localToken}` }, body: JSON.stringify({ id: 'disabled' }) });
    assert.equal(result.status, 503);
  } finally { await runtime.dispose(); }
});
