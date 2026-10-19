export const json = (value: unknown, status = 200) => Response.json(value, { status });
export class Problem extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function authorize(request: Request, env: { P0_TOKEN?: string }) {
  if (!env.P0_TOKEN || env.P0_TOKEN.length < 24) throw new Problem(503, 'P0 secret is not configured');
  if (request.headers.get('Authorization') !== `Bearer ${env.P0_TOKEN}`) throw new Problem(401, 'Unauthorized');
}
export async function boundedBytes(stream: ReadableStream<Uint8Array>, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Problem(413, 'Experiment input too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function bodyJson(request: Request) {
  if (!request.body) throw new Problem(400, 'JSON body required');
  try {
    const value = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 8192)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Problem(400, 'JSON object required');
    return value;
  }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'Invalid JSON'); }
}
export function runId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Problem(400, 'Invalid run id');
  return value;
}
export async function hash(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function failure(error: unknown) {
  return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof Problem ? error.status : 500);
}
