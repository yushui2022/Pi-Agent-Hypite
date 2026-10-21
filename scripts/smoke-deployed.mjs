// End-to-end smoke test against a deployed Worker.
//
// Runs the real flow: register -> create project -> authorize upload -> PUT to R2 with the
// signed URL -> confirm -> read the asset back. The PUT comes from Node rather than a browser,
// so this proves the signed URL and the confirmation path, not the CORS preflight.
//
// Creates one smoke account and one project in the target database and says so in the output.
import { createHash } from 'node:crypto';

const base = process.argv[2];
if (!base || !/^https:\/\/[^/]+$/.test(base)) {
  console.error('usage: node scripts/smoke-deployed.mjs https://<worker-host>');
  process.exit(2);
}

const report = { schema: 'pi-studio.deploy-smoke@1', startedAt: new Date().toISOString(), base, checks: [] };
const digestHex = bytes => createHash('sha256').update(bytes).digest('hex');
let cookie = '';

async function check(name, fn) {
  const detail = await fn();
  report.checks.push({ name, passed: true, ...(detail ? { detail } : {}) });
  console.log('PASS ' + name);
}

async function api(route, { method = 'GET', body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = response.headers.get('Set-Cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}

const expect = async (response, status) => {
  const data = await response.json().catch(() => ({}));
  if (response.status !== status) throw new Error(`期望 ${status}，实际 ${response.status}：${JSON.stringify(data)}`);
  return data;
};

try {
  await check('健康检查与首页可用', async () => {
    await expect(await api('/healthz'), 200);
    const page = await fetch(base + '/');
    const html = await page.text();
    if (page.status !== 200) throw new Error(`首页 HTTP ${page.status}`);
    if (!/<html/i.test(html)) throw new Error('首页不是 HTML');
    return { pageBytes: html.length };
  });

  const email = `smoke+${Date.now()}@example.test`;
  await check('注册（会在此数据库创建一个 smoke 账号）', async () => {
    const body = await expect(await api('/api/auth/register', { method: 'POST', body: { email, password: 'correct-horse-9', name: '冒烟' } }), 200);
    if (!/^pi_saas_session=/.test(cookie)) throw new Error('未收到会话 Cookie');
    return { email, workspace: body.user.workspace_name };
  });

  let projectId;
  await check('创建项目', async () => {
    const created = await expect(await api('/api/remix', { method: 'POST', body: { requestId: crypto.randomUUID(), title: '线上冒烟' } }), 201);
    projectId = created.id;
    return { projectId };
  });

  const bytes = Buffer.from(`deploy-smoke-${Date.now()}`, 'utf8');
  const sha256 = digestHex(bytes);
  let assetId;
  await check('申请上传 → 直传 R2 → 确认 → 素材登记', async () => {
    const upload = (await expect(await api('/api/uploads', { method: 'POST', body: { projectId, name: 'smoke.mp4', mime: 'video/mp4', size: bytes.length, sha256 } }), 201)).upload;

    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) throw new Error(`直传失败 HTTP ${put.status}：${(await put.text()).slice(0, 200)}`);

    const done = await expect(await api(`/api/uploads/${upload.uploadId}/complete`, { method: 'POST' }), 200);
    assetId = done.assetId;

    const project = await expect(await api('/api/remix/' + projectId), 200);
    if (project.assets.length !== 1) throw new Error('项目里应有 1 个素材');
    if (project.assets[0].sha256 !== sha256) throw new Error('登记的哈希与上传不一致');
    return { assetId, key: upload.key.replace(/[a-f0-9-]{36}/g, '<id>') };
  });

  await check('素材可鉴权读取且内容一致，匿名访问被拒', async () => {
    const authed = await fetch(`${base}/api/media/${projectId}/${assetId}`, { headers: { Cookie: cookie } });
    if (authed.status !== 200) throw new Error(`读取 HTTP ${authed.status}`);
    const stored = Buffer.from(await authed.arrayBuffer());
    if (digestHex(stored) !== sha256) throw new Error('读取到的内容与上传不一致');
    const anonymous = await fetch(`${base}/api/media/${projectId}/${assetId}`);
    if (anonymous.status !== 401) throw new Error(`匿名读取应 401，实际 ${anonymous.status}`);
    return { bytes: stored.length };
  });

  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error('FAIL: ' + report.error);
} finally {
  console.log(JSON.stringify({ ok: report.ok, base, checks: report.checks.length, error: report.error }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
