// AWS Signature Version 4 presigning for R2's S3-compatible endpoint.
//
// Why this exists: a Worker cannot buffer a 100 MB upload, so the browser must talk to R2
// directly. The Worker only issues a short-lived signed URL and verifies the result.
//
// Scope note: this produces the URL, not the trust. Nothing here proves the signature is
// accepted by R2 — only a real bucket can (local workerd exposes an R2 binding, not an S3
// endpoint). Local tests cover encoding, bounds and determinism against a second
// independent implementation; the bucket remains the acceptance test.
//
// Web Crypto only, so the same module runs in a Worker.

const encoder = new TextEncoder();

/** RFC 3986 escaping: encodeURIComponent also leaves !'()* alone, SigV4 does not. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)));
}

/** YYYYMMDD'T'HHMMSS'Z' — the only date form SigV4 accepts. */
export function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export interface PresignInput {
  method: 'PUT' | 'GET' | 'DELETE';
  /** S3-compatible origin only, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  /** Object key, unencoded. Callers pass a server-generated key, never client input. */
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
  expiresSeconds?: number;
  now?: Date;
  /**
   * Extra headers the client must send. They are part of the signature, so the client
   * cannot drop them — that is how the upload checksum is enforced instead of trusted.
   */
  extraHeaders?: Record<string, string>;
}

export const MAX_PRESIGN_SECONDS = 60 * 60 * 24 * 7;

export interface PresignResult {
  url: string;
  amzDate: string;
  expiresSeconds: number;
  /** Headers the client must send verbatim, or the signature will not match. */
  headers: Record<string, string>;
  /** The canonical request that was signed. Kept for audit and for the local cross-check. */
  canonicalRequest: string;
  signature: string;
}

export async function presignS3Url(input: PresignInput): Promise<PresignResult> {
  const region = input.region ?? 'auto';
  const service = 's3';
  const expiresSeconds = input.expiresSeconds ?? 900;
  if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > MAX_PRESIGN_SECONDS) {
    throw new Error(`Presign expiry must be 1-${MAX_PRESIGN_SECONDS} seconds`);
  }
  if (!/^https?:\/\/[^/]+$/.test(input.endpoint)) throw new Error('Endpoint must be an origin without a path');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket)) throw new Error('Invalid bucket name');
  if (!input.key || input.key.startsWith('/')) throw new Error('Object key must be relative');

  const endpoint = new URL(input.endpoint);
  const host = endpoint.host;
  const canonicalUri = '/' + [input.bucket, ...input.key.split('/')].map(uriEncode).join('/');
  const { amzDate: stamp, dateStamp } = amzDate(input.now ?? new Date());
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const signedHeaderPairs: [string, string][] = [['host', host]];
  for (const [name, value] of Object.entries(input.extraHeaders ?? {})) {
    const lower = name.toLowerCase();
    if (lower === 'host' || lower === 'x-amz-signature') throw new Error('Refusing to override a signing header');
    signedHeaderPairs.push([lower, value.trim()]);
  }
  signedHeaderPairs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const signedHeaders = signedHeaderPairs.map(([name]) => name).join(';');
  const canonicalHeaders = signedHeaderPairs.map(([name, value]) => `${name}:${value}\n`).join('');

  const query: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  if (input.sessionToken) query.push(['X-Amz-Security-Token', input.sessionToken]);
  // Canonical query is sorted by encoded key, then value; do not rely on insertion order.
  const canonicalQuery = query
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  // The payload is not hashed, so a PUT body never needs buffering in the Worker.
  const canonicalRequest = [input.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  let key = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, stringToSign));

  const headers: Record<string, string> = {};
  for (const [name, value] of signedHeaderPairs) if (name !== 'host') headers[name] = value;

  return {
    url: `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    amzDate: stamp,
    expiresSeconds,
    headers,
    canonicalRequest,
    signature,
  };
}
