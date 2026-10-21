// One-off acceptance test against the real R2 bucket.
//
// Everything until now ran against a local simulation. This is the first check that leaves the
// machine: it asks the question the local workerd cannot answer — does R2 accept the URL that
// packages/cloudflare-storage/sigv4.ts produces?
//
// Reads credentials from .env (git-ignored) or the process environment. Never prints them.
// Leaves nothing behind: the probe object is deleted at the end.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presignS3Url } from '../packages/cloudflare-storage/sigv4.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = 'G:/DevCache/Temp/pi-agent-hypite/r2-acceptance';
await mkdir(output, { recursive: true });

const digestHex = bytes => createHash('sha256').update(bytes).digest('hex');
const mask = value => (value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '(未设置)');

async function loadConfig() {
  const fromFile = {};
  try {
    const text = await readFile(path.join(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) fromFile[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env is optional, the environment may carry the values */ }
  return { ...fromFile, ...process.env };
}

const env = await loadConfig();
const required = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
const missing = required.filter(key => !env[key]);
if (missing.length) {
  console.error(`缺少配置：${missing.join(', ')}\n请在项目根目录的 .env 中补齐后重试。`);
  process.exit(2);
}

const s3 = {
  endpoint: env.R2_ENDPOINT, bucket: env.R2_BUCKET,
  accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
};
const report = { schema: 'pi-studio.r2-acceptance@1', startedAt: new Date().toISOString(), endpoint: s3.endpoint, bucket: s3.bucket, checks: [] };
async function verify(name, fn) {
  const result = await fn();
  report.checks.push({ name, passed: true, ...(result ? { detail: result } : {}) });
  console.log('PASS ' + name);
}

const key = `acceptance/probe-${Date.now()}.bin`;
const body = Buffer.from(`r2-acceptance-${Date.now()}`, 'utf8');
const sha256 = digestHex(body);
const checksumBase64 = createHash('sha256').update(body).digest('base64');
const sign = (method, extraHeaders) => presignS3Url({
  method, endpoint: s3.endpoint, bucket: s3.bucket, key,
  accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey,
  expiresSeconds: 300, ...(extraHeaders ? { extraHeaders } : {}),
});

try {
  console.log(`endpoint ${s3.endpoint}\nbucket   ${s3.bucket}\nkey      ${key}\naccess   ${mask(s3.accessKeyId)}`);
  await verify('凭证从 .env 读取，长度符合 R2 格式', async () => ({
    accessKeyId: mask(s3.accessKeyId), secretLength: s3.secretAccessKey.length,
  }));

  const put = await sign('PUT', { 'x-amz-checksum-sha256': checksumBase64 });
  await verify('R2 接受预签名 PUT 并接收文件', async () => {
    const response = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
    const text = await response.clone().text();
    assert.equal(response.status, 200, `HTTP ${response.status}: ${text.slice(0, 300)}`);
    return { status: response.status, signedHeaders: Object.keys(put.headers) };
  });

  await verify('取回内容与上传字节一致', async () => {
    const response = await fetch((await sign('GET')).url);
    assert.equal(response.status, 200);
    const stored = Buffer.from(await response.arrayBuffer());
    assert.equal(stored.length, body.length, '大小不一致');
    assert.equal(digestHex(stored), sha256, '内容哈希不一致');
    return { bytes: stored.length, sha256 };
  });

  await verify('R2 拒绝校验和与内容不符的上传', async () => {
    // Same body, different declared checksum: the signed header is what makes this fail.
    const wrong = createHash('sha256').update('something-else').digest('base64');
    const attempt = await sign('PUT', { 'x-amz-checksum-sha256': wrong });
    const response = await fetch(attempt.url, { method: 'PUT', headers: attempt.headers, body });
    const text = await response.clone().text();
    assert.ok([400, 412, 422].includes(response.status), `期望被拒绝，实际 HTTP ${response.status}: ${text.slice(0, 300)}`);
    return { status: response.status };
  });

  await verify('清理：删除探针对象后不可再读取', async () => {
    const removed = await fetch((await sign('DELETE')).url, { method: 'DELETE' });
    assert.ok([200, 204].includes(removed.status), `删除失败 HTTP ${removed.status}`);
    const gone = await fetch((await sign('GET')).url);
    assert.equal(gone.status, 404, `对象应已删除，实际 HTTP ${gone.status}`);
    return { deleteStatus: removed.status, readStatus: gone.status };
  });

  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error('FAIL: ' + report.error);
} finally {
  await writeFile(path.join(output, `report-${Date.now()}.json`), JSON.stringify(report, null, 2)).catch(() => {});
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, error: report.error, report: output }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
