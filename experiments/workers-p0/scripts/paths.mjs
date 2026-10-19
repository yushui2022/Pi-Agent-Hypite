import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const repo = path.resolve(root, '../..');
export const output = process.env.P0_OUTPUT_DIR || 'G:/DevCache/Temp/pi-agent-hypite/workers-p0';
export const dist = path.join(root, 'dist');
