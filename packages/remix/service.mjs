import { inspectPreparation } from './preparation.mjs';
import { projectRevision, fault, assertProjectId } from './revision.mjs';

const fail = (message, status) => { throw fault(message, status); };
const str = (s, max = 200) => {
  if (typeof s !== 'string' || !s.trim() || s.length > max) fail('必填内容为空或过长');
  return s.trim();
};

/** Runtime-neutral business logic. Repository and media ports are already tenant-scoped. */
export function createRemixService({ repository, media }) {
  async function read(id) {
    assertProjectId(id);
    return repository.read(id);
  }
  async function save(document, expectedRevision) {
    if (new TextEncoder().encode(JSON.stringify(document)).length > 2 * 1024 * 1024) {
      fail('项目计划达到当前容量限制，请拆分为另一个项目');
    }
    await repository.save(document, { expectedRevision });
  }
  async function show(id) {
    const p = await read(id);
    return {
      ...p, revision: await projectRevision(p),
      assets: await Promise.all(p.assets.map(async a => ({
        ...a, available: await media.available(id, a), url: await media.url(id, a),
      }))),
    };
  }
  async function list() {
    if (repository.summaries) return (await repository.summaries()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const rows = [];
    for (const id of await repository.ids()) {
      const p = await read(id);
      rows.push({ id, title: p.title, createdAt: p.createdAt, assets: p.assets.length, batches: p.batches.length });
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function create(input) {
    const title = str(input.title, 120), brief = input.brief === undefined ? '' : str(input.brief, 2000);
    if (!/^[a-f0-9-]{36}$/.test(input.requestId)) fail('需要请求编号');
    const id = 'remix_' + input.requestId;
    const existing = async () => {
      const old = await read(id);
      if (old.title !== title || (old.brief || '') !== brief) fail('请求编号已使用', 409);
      return show(id);
    };
    try { return await existing(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const p = { id, title, brief, createdAt: new Date().toISOString(), assets: [], plan: { referenceId: '', preserve: '', rows: [] }, batches: [] };
    try { await save(p, null); } catch (e) {
      // A concurrent retry may have created the same intent while this request was hashing.
      if (e.status !== 409) throw e;
      try { return await existing(); } catch (readError) { if (readError.code === 'ENOENT') throw e; throw readError; }
    }
    return show(id);
  }
  async function asset(id, assetId) {
    const p = await read(id), found = p.assets.find(a => a.id === assetId);
    if (!found) fail('素材不存在', 404);
    return found;
  }
  // Internal completion hook, called only after storage has verified the uploaded bytes.
  async function registerAsset(id, entry) {
    if (!/^asset_[a-f0-9-]{36}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.size) || entry.size < 1) fail('素材记录无效');
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await read(id), revision = await projectRevision(p);
      const old = p.assets.find(a => a.sha256 === entry.sha256);
      if (old) return { assetId: old.id, duplicate: true };
      if (p.assets.some(a => a.id === entry.id)) fail('素材编号已使用', 409);
      p.assets.push(entry);
      try { await save(p, revision); return { assetId: entry.id, duplicate: false }; }
      catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
    }
    throw fault('素材登记发生版本冲突，请重试', 409);
  }
  async function savePlan(id, input) {
    const p = await read(id);
    if (await projectRevision(p) !== input.revision) fail('项目已更新，请重新打开后再保存', 409);
    const plan = input.plan;
    if (!plan || !Array.isArray(plan.rows) || plan.rows.length > 100) fail('替换方案最多 100 项');
    const ref = p.assets.find(a => a.id === plan.referenceId && a.mime.startsWith('video/'));
    if (!ref) fail('请选择已导入的参考视频');
    const preserve = typeof plan.preserve === 'string' && plan.preserve.length <= 2000 ? plan.preserve : fail('保留说明过长');
    const keys = new Set();
    const rows = plan.rows.map(r => {
      const key = str(r.key, 80);
      if (keys.has(key)) fail('替换位置名称不能重复');
      keys.add(key);
      if (!['video', 'image', 'audio', 'text'].includes(r.type)) fail('替换类型无效');
      const start = Number(r.start), end = Number(r.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) fail('时间段需满足结束大于开始，单位为秒');
      const value = typeof r.value === 'string' && r.value.length <= 2000 ? r.value : fail('替换文案过长');
      if (r.assetId && !p.assets.some(a => a.id === r.assetId && a.mime.startsWith(r.type + '/'))) fail('替换素材类型不匹配');
      return { key, type: r.type, start, end, assetId: r.assetId || '', value };
    });
    p.plan = { referenceId: ref.id, preserve, rows };
    await save(p, input.revision);
    return show(id);
  }
  async function check(id, input) {
    const p = await show(id);
    if (p.revision !== input.revision) fail('项目已更新，请重新打开后检查', 409);
    if (input.batchId !== undefined && (typeof input.batchId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.batchId))) fail('批次编号无效');
    return inspectPreparation(p, { batchId: input.batchId, revision: p.revision });
  }
  async function makeBatch(id, input) {
    const p = await read(id);
    if (input.sourceBatchId !== undefined && (typeof input.sourceBatchId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.sourceBatchId))) fail('来源批次编号无效');
    if (!/^[a-f0-9-]{36}$/.test(input.requestId)) fail('请求编号无效');
    const fingerprint = await projectRevision({ title: input.title, variants: input.variants, revision: input.revision, ...(input.sourceBatchId ? { sourceBatchId: input.sourceBatchId } : {}) });
    const old = p.batches.find(b => b.id === input.requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) fail('请求编号已使用', 409);
      return show(id);
    }
    if (await projectRevision(p) !== input.revision) fail('项目已更新，请重新打开后重试', 409);
    const source = input.sourceBatchId ? p.batches.find(b => b.id === input.sourceBatchId) : null;
    if (input.sourceBatchId && !source) fail('来源批次不存在', 404);
    const batchPlan = source?.plan || p.plan;
    if (!batchPlan.referenceId || !batchPlan.rows.length) fail('请先保存参考与替换方案');
    if (p.batches.length >= 100) fail('每项目最多 100 个批次');
    if (!Array.isArray(input.variants) || !input.variants.length || input.variants.length > 20) fail('新批次支持 1–20 条明确变体；历史批次保留');
    const variants = input.variants.map(v => {
      const label = str(v.label, 120), overrides = v.overrides || {};
      if (Object.keys(overrides).some(k => !batchPlan.rows.some(r => r.key === k))) fail('未知替换位置');
      const rows = batchPlan.rows.map(row => {
        const override = Object.hasOwn(overrides, row.key) ? overrides[row.key] : undefined;
        if (override === undefined) return { ...row };
        if (row.type === 'text') return { ...row, value: str(override, 2000) };
        if (!p.assets.some(a => a.id === override && a.mime.startsWith(row.type + '/'))) fail('变体素材不匹配');
        return { ...row, assetId: override };
      });
      return { id: 'variant_' + crypto.randomUUID(), label, rows };
    });
    const blocked = [];
    for (const a of p.assets.filter(a => a.id === batchPlan.referenceId || variants.some(v => v.rows.some(r => r.assetId === a.id)))) {
      if (!await media.available(id, a)) blocked.push(`文件缺失：${a.name}`);
    }
    for (const v of variants) for (const r of v.rows) {
      if (r.type === 'text' ? !r.value.trim() : !r.assetId) blocked.push(`${v.label} / ${r.key} 尚未分配`);
    }
    p.batches.push({ id: input.requestId, title: str(input.title, 120), createdAt: new Date().toISOString(), fingerprint,
      ...(source ? { sourceBatchId: source.id } : {}), plan: structuredClone(batchPlan), variants, blocked, state: 'planned', outputs: [] });
    try { await save(p, input.revision); } catch (e) {
      if (e.status !== 409) throw e;
      const retry = (await read(id)).batches.find(b => b.id === input.requestId);
      if (!retry || retry.fingerprint !== fingerprint) throw e;
    }
    return show(id);
  }
  return { read, list, show, create, asset, registerAsset, savePlan, makeBatch, check };
}
