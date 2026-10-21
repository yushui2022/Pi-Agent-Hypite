import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { projectRevision, assertProjectId, assertRevision, fault } from './revision.mjs';

// Covers multiple managers in this process. Multi-process hosting uses SQLite or D1.
const writes = new Map();
export function createLocalRepository(root) {
  const file = id => { assertProjectId(id); return path.resolve(root, id, 'project.json'); };
  const read = async id => JSON.parse(await readFile(file(id), 'utf8'));
  return {
    read,
    async ids() {
      await mkdir(root, { recursive: true });
      return (await readdir(root)).filter(id => /^remix_[a-f0-9-]{36}$/.test(id));
    },
    async save(document, { expectedRevision }) {
      assertRevision(expectedRevision);
      const target = file(document.id);
      const operation = (writes.get(target) || Promise.resolve()).catch(() => {}).then(async () => {
        let current;
        try { current = await read(document.id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (expectedRevision === null ? current !== undefined : !current || await projectRevision(current) !== expectedRevision) {
          throw fault('项目已更新，请重新打开后重试', 409);
        }
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = target + '.' + crypto.randomUUID() + '.tmp';
        try {
          await writeFile(temporary, JSON.stringify(document, null, 2), { flag: 'wx' });
          await rename(temporary, target);
        } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
      });
      writes.set(target, operation);
      try { await operation; } finally { if (writes.get(target) === operation) writes.delete(target); }
    },
  };
}
