import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkDriver } from '../scripts/benchmark-driver.mjs';

test('Remote benchmark rejects credential URLs and never follows redirects or retries', async () => {
  await assert.rejects(benchmarkDriver('http://example.com'), /HTTPS/);
  await assert.rejects(benchmarkDriver('https://user:secret@example.com'), /HTTPS/);
  await assert.rejects(benchmarkDriver('https://example.com/?token=secret'), /HTTPS/);
  const previousToken = process.env.P0_TOKEN;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.P0_TOKEN = 'test-only-token-never-a-cloud-secret';
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://test.invalid');
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://different.invalid', 'cf-ray': 'test-ray' } });
  };
  try {
    const driver = await benchmarkDriver('https://test.invalid');
    await assert.rejects(driver.health(), /redirect/);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(driver.events).includes(process.env.P0_TOKEN), false);
    assert.equal(driver.events[0].cfRay, 'test-ray');
    await driver.dispose();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.P0_TOKEN; else process.env.P0_TOKEN = previousToken;
  }
});
