import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { presignS3Url, uriEncode, amzDate, MAX_PRESIGN_SECONDS } from '../packages/cloudflare-storage/sigv4.ts';

// Independent reference implementation built from the published SigV4 steps with node:crypto.
// It is written as a second code path on purpose: if both drift the same way this cannot catch
// it, but it does catch the ordinary mistakes (ordering, escaping, header set, key chain).
const escape = value => encodeURIComponent(value).replace(/[!*'()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());

function reference({ method, endpoint, bucket, key, accessKeyId, secretAccessKey, sessionToken, region = 'auto', expiresSeconds = 900, now, extraHeaders = {} }) {
  const host = new URL(endpoint).host;
  const amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amz.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;

  const headerPairs = [['host', host], ...Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value.trim()])]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const signedHeaders = headerPairs.map(([name]) => name).join(';');
  const canonicalHeaders = headerPairs.map(([name, value]) => `${name}:${value}\n`).join('');

  const params = new Map([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amz],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ]);
  if (sessionToken) params.set('X-Amz-Security-Token', sessionToken);
  const canonicalQuery = [...params.entries()].map(([name, value]) => `${escape(name)}=${escape(value)}`).sort().join('&');
  const canonicalUri = '/' + [bucket, ...key.split('/')].map(escape).join('/');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const chain = (keyBytes, value) => createHmac('sha256', keyBytes).update(value).digest();
  let signingKey = chain(`AWS4${secretAccessKey}`, day);
  signingKey = chain(signingKey, region);
  signingKey = chain(signingKey, 's3');
  signingKey = chain(signingKey, 'aws4_request');
  return { signature: createHmac('sha256', signingKey).update(stringToSign).digest('hex'), canonicalRequest, canonicalUri, canonicalQuery };
}

const checksum = 'a'.repeat(64);
const base = {
  method: 'PUT',
  endpoint: 'https://acct123.r2.cloudflarestorage.com',
  bucket: 'pi-media',
  key: 'workspaces/w1/projects/remix_x/assets/asset_y',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  now: new Date('2026-10-20T12:34:56.000Z'),
};

test('SigV4 presign matches an independent implementation', async () => {
  const cases = [
    base,
    { ...base, key: 'workspaces/w 1/a b/素材 名称.mp4' },
    { ...base, key: 'a/b/c/d/e/f/final.mp4', expiresSeconds: 60 },
    { ...base, sessionToken: 'session-token-value' },
    { ...base, method: 'GET' },
    { ...base, extraHeaders: { 'x-amz-checksum-sha256': checksum } },
    { ...base, extraHeaders: { 'x-amz-checksum-sha256': checksum, 'content-type': 'video/mp4' } },
  ];
  for (const input of cases) {
    const actual = await presignS3Url(input);
    const expected = reference(input);
    assert.equal(actual.signature, expected.signature, input.key);
    assert.equal(actual.canonicalRequest, expected.canonicalRequest, input.key);
    assert.ok(actual.url.includes(expected.canonicalQuery), input.key);
  }
});

test('checksum and content type are signed, so the client cannot drop them', async () => {
  const result = await presignS3Url({ ...base, extraHeaders: { 'X-Amz-Checksum-Sha256': checksum, 'content-type': 'video/mp4' } });
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host;x-amz-checksum-sha256');
  assert.equal(result.headers['x-amz-checksum-sha256'], checksum);
  assert.equal(result.headers['content-type'], 'video/mp4');
  assert.equal(result.headers.host, undefined, 'host 只参与签名，不由调用方重复发送');
  await assert.rejects(() => presignS3Url({ ...base, extraHeaders: { Host: 'evil.test' } }), /override/);
  await assert.rejects(() => presignS3Url({ ...base, extraHeaders: { 'X-Amz-Signature': 'x' } }), /override/);
});

test('canonical request signs only declared headers and never hashes the payload', async () => {
  const result = await presignS3Url(base);
  const lines = result.canonicalRequest.split('\n');
  assert.deepEqual(lines.slice(0, 1), ['PUT']);
  // Canonical headers end with a blank line, so 3 is the host header and 4 is its newline.
  assert.equal(lines[3], 'host:acct123.r2.cloudflarestorage.com');
  assert.equal(lines[4], '');
  assert.equal(lines[5], 'host');
  assert.equal(lines[6], 'UNSIGNED-PAYLOAD', '上传体积不能被 Worker 缓冲，payload 必须不参与签名');
  assert.ok(!result.canonicalRequest.includes('X-Amz-Signature'), '签名不能覆盖自身');
});

test('object keys are RFC 3986 escaped, including characters encodeURIComponent leaves alone', async () => {
  const result = await presignS3Url({ ...base, key: "a b/c!d*e'f(g)h.mp4" });
  assert.equal(new URL(result.url).pathname, '/pi-media/a%20b/c%21d%2Ae%27f%28g%29h.mp4');
  assert.equal(uriEncode('a!b'), 'a%21b');
  assert.equal(uriEncode('a/b'), 'a%2Fb');
});

test('expiry bounds and unsafe inputs are refused', async () => {
  await assert.rejects(() => presignS3Url({ ...base, expiresSeconds: 0 }), /expiry/);
  await assert.rejects(() => presignS3Url({ ...base, expiresSeconds: MAX_PRESIGN_SECONDS + 1 }), /expiry/);
  await assert.rejects(() => presignS3Url({ ...base, expiresSeconds: 900.5 }), /expiry/);
  await assert.rejects(() => presignS3Url({ ...base, endpoint: 'https://acct.r2.cloudflarestorage.com/bucket' }), /origin/);
  await assert.rejects(() => presignS3Url({ ...base, key: '/absolute' }), /relative/);
  await assert.rejects(() => presignS3Url({ ...base, bucket: 'Bad_Bucket' }), /bucket/);
});

test('signing is deterministic for one instant and varies with the instant', async () => {
  const first = await presignS3Url(base);
  const again = await presignS3Url(base);
  assert.equal(first.url, again.url);
  const later = await presignS3Url({ ...base, now: new Date('2026-10-20T12:34:57.000Z') });
  assert.notEqual(later.signature, first.signature);
});

test('URL carries the required signing parameters', async () => {
  const result = await presignS3Url(base);
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-Credential'), 'AKIDEXAMPLE/20261020/auto/s3/aws4_request');
  assert.equal(url.searchParams.get('X-Amz-Date'), '20261020T123456Z');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
  assert.equal(amzDate(base.now).dateStamp, '20261020');
});
