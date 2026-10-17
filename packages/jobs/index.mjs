import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { inspectSource } from '../hypit-adapter/index.mjs';

const idPattern = /^job_[a-f0-9-]{36}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
export { loadConfig } from '../config/index.mjs';
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function save(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, file);
}
export function validateBrief(brief) {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) throw new Error('Brief must be an object');
  for (const key of ['title', 'account', 'product', 'language', 'requirements']) {
    if (typeof brief[key] !== 'string' || !brief[key].trim() || brief[key].length > 10000) throw new Error(`Invalid brief.${key}`);
  }
  if (typeof brief.technicalSample !== 'boolean') throw new Error('brief.technicalSample must be boolean');
  if (!Array.isArray(brief.references) || brief.references.some(x => typeof x !== 'string' || !x.trim())) throw new Error('brief.references must be a list of paths or URLs');
  // No provider credentials belong in this business record.
  return Object.fromEntries(['title', 'account', 'product', 'language', 'requirements', 'technicalSample', 'references'].map(key => [key, brief[key]]));
}
export async function jobDirectory(config, id) {
  if (!idPattern.test(id)) throw new Error('Invalid job ID');
  const base = await realpath(config.dataRoot);
  const dir = await realpath(path.join(base, id));
  if (path.dirname(dir).toLowerCase() !== base.toLowerCase()) throw new Error('Job directory escapes data root');
  return dir;
}
export async function createJob(config, input) {
  const brief = validateBrief(input);
  const id = `job_${randomUUID()}`;
  const dir = path.join(config.dataRoot, id);
  await mkdir(dir, { recursive: true });
  for (const name of ['project', 'inspections']) await mkdir(path.join(dir, name));
  await save(path.join(dir, 'project/package.json'), { name: id.replaceAll('_', '-'), private: true, type: 'module' });
  await save(path.join(dir, 'brief.json'), brief);
  const job = { format: 'production-job@1', id, createdAt: new Date().toISOString(), title: brief.title, status: 'draft', technicalSample: brief.technicalSample };
  // Manifest is written last; partially created directories cannot appear as valid jobs.
  await save(path.join(dir, 'job.json'), job);
  return { ...job, directory: dir };
}
export async function showJob(config, id) {
  const dir = await jobDirectory(config, id);
  const inspections = await Promise.all((await readdir(path.join(dir, 'inspections'))).filter(x => x.endsWith('.json')).map(x => json(path.join(dir, 'inspections', x))));
  inspections.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const brief = await json(path.join(dir, 'brief.json'));
  return { ...await json(path.join(dir, 'job.json')), title: brief.title, brief, revision: sha(JSON.stringify(brief)), directory: dir, inspections };
}
export async function listJobs(config) {
  await mkdir(config.dataRoot, { recursive: true });
  const entries = await readdir(config.dataRoot, { withFileTypes: true });
  const jobs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    try { jobs.push(await showJob(config, entry.name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
// Caller serializes writes; the local server additionally checks optimistic revisions.
export async function updateBrief(config, id, input, expectedRevision) {
  const job = await showJob(config, id);
  if (job.revision !== expectedRevision) { const error = new Error('需求已在其他窗口修改，请刷新后再保存'); error.status = 409; throw error; }
  const brief = validateBrief(input);
  await save(path.join(job.directory, 'brief.json'), brief);
  return showJob(config, id);
}
export async function inspectJob(config, id, operation, relativeSource) {
  if (!['check', 'plan'].includes(operation)) throw new Error('Only check and plan are supported');
  if (typeof relativeSource !== 'string' || !relativeSource || path.isAbsolute(relativeSource)) throw new Error('Source must be project-relative');
  const dir = await jobDirectory(config, id);
  const workspace = await realpath(path.join(dir, 'project'));
  if (path.dirname(workspace).toLowerCase() !== dir.toLowerCase()) throw new Error('Project directory escapes job');
  const source = await realpath(path.resolve(workspace, relativeSource));
  const rel = path.relative(workspace, source);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Source escapes job project');
  if (!['.svml', '.svrun', '.svs'].includes(path.extname(source))) throw new Error('Unsupported source extension');
  await mkdir(config.tempRoot, { recursive: true });
  const before = sha(await readFile(source));
  const result = await inspectSource({ cli: path.join(config.hypitRoot, 'bin/hypit.mjs'), workspace, source, operation, tempRoot: config.tempRoot });
  let after = null;
  try { after = sha(await readFile(source)); } catch { /* The editor may have removed the entry during the check. */ }
  const record = {
    ...result, id: randomUUID(), jobId: id,
    sourceHashBefore: before, sourceHashAfter: after,
    sourceChanged: before !== after,
    ok: result.ok && before === after,
    // Entry hash is evidence only: imported files are not a frozen release snapshot.
    hashScope: 'entry-only',
  };
  await save(path.join(dir, 'inspections', `${record.id}.json`), record);
  return record;
}
