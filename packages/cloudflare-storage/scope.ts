import { fault } from '../remix/revision.mjs';

export function assertWorkspaceId(id: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
    throw fault('空间编号无效');
  }
}
