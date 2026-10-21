// Worker-side accounts and sessions.
//
// Password storage deliberately differs from the local Node server. The local server uses
// scrypt (packages/saas/store.mjs); Workers have no scrypt in Web Crypto and no node:crypto
// scrypt, so a Worker cannot verify an existing scrypt hash. Cloud accounts therefore use
// PBKDF2-HMAC-SHA256, which Web Crypto does provide.
//
// Consequences are made explicit rather than hidden:
//   - The stored string carries its own algorithm, so a format change stays detectable.
//   - A legacy scrypt hash is refused with reason 'legacy-scrypt', not reported as a wrong
//     password. The user must set a new password; the hash cannot be converted without the
//     plaintext.
//   - Nothing in this module silently accepts an unrecognised hash format.
import { fault } from '../remix/revision.mjs';
import { assertWorkspaceId } from './scope';

export const PASSWORD_ITERATIONS = 210_000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PREFIX = 'pbkdf2-sha256';
const encoder = new TextEncoder();

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => new Uint8Array((value.match(/../g) ?? []).map(pair => parseInt(pair, 16)));

export function passwordFormat(stored: string): 'current' | 'legacy-scrypt' | 'unknown' {
  if (stored.startsWith(`${PREFIX}$`)) return 'current';
  // The local server stores 64 derived bytes as bare hex.
  if (/^[a-f0-9]{128}$/.test(stored)) return 'legacy-scrypt';
  return 'unknown';
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, salt, PASSWORD_ITERATIONS);
  return `${PREFIX}$${PASSWORD_ITERATIONS}$${hex(salt)}$${hex(derived)}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'mismatch' | 'legacy-scrypt' | 'unknown' };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<VerifyResult> {
  const format = passwordFormat(stored);
  if (format !== 'current') return { ok: false, reason: format };
  const [prefix, rawIterations, saltHex, expectedHex] = stored.split('$');
  const iterations = Number(rawIterations);
  if (prefix !== PREFIX || !Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 ||
      !/^[a-f0-9]{32}$/.test(saltHex ?? '') || !/^[a-f0-9]{64}$/.test(expectedHex ?? '')) {
    return { ok: false, reason: 'unknown' };
  }
  const derived = await derive(password, unhex(saltHex), iterations);
  return sameBytes(derived, unhex(expectedHex)) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

export async function tokenDigest(token: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))));
}

export function newSessionToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export interface Account {
  userId: string; workspaceId: string; email: string; name: string; workspaceName: string;
}

export interface Credentials { email: string; password: string; name?: string }

export function credentials(input: unknown): Credentials {
  const body = (input ?? {}) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw fault('请输入有效邮箱', 400);
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) throw fault('密码需为 10–128 个字符', 400);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  return { email, password: body.password, name };
}

interface Row {
  id: string; email: string; name: string; salt: string; password_hash: string;
}

async function issueSession(db: D1Database, userId: string, workspaceId: string): Promise<string> {
  const token = newSessionToken();
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)')
      .bind(await tokenDigest(token), userId, workspaceId, now + SESSION_TTL_MS),
  ]);
  return token;
}

export async function register(db: D1Database, input: unknown): Promise<{ token: string; account: Account }> {
  const { email, password, name } = credentials(input);
  if (!name || name.length > 80) throw fault('请填写不超过 80 字的昵称', 400);
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const workspaceName = `${name}的创作空间`;
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await hashPassword(password);
  try {
    // One batch keeps user, workspace, membership and the email uniqueness check together.
    await db.batch([
      db.prepare('INSERT INTO users(id,email,name,salt,password_hash) VALUES (?,?,?,?,?)').bind(userId, email, name, salt, passwordHash),
      db.prepare('INSERT INTO workspaces(id,name) VALUES (?,?)').bind(workspaceId, workspaceName),
      db.prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)').bind(userId, workspaceId, 'owner'),
    ]);
  } catch (error) {
    // A unique-email violation is a conflict; anything else is a real storage failure.
    if (/UNIQUE|constraint/i.test(String((error as Error)?.message))) throw fault('此邮箱无法注册，请尝试登录', 409);
    throw error;
  }
  const token = await issueSession(db, userId, workspaceId);
  return { token, account: { userId, workspaceId, email, name, workspaceName } };
}

export async function login(db: D1Database, input: unknown): Promise<{ token: string; account: Account }> {
  const { email, password } = credentials(input);
  const row = await db.prepare('SELECT id,email,name,salt,password_hash FROM users WHERE email=?').bind(email).first<Row>();
  if (!row) {
    // Spend comparable work for unknown accounts so timing does not reveal existence.
    await hashPassword(password);
    throw fault('邮箱或密码不正确', 401);
  }
  const result = await verifyPassword(password, row.password_hash);
  if (!result.ok) {
    if (result.reason === 'legacy-scrypt' || result.reason === 'unknown') {
      throw fault('该账号的密码需要在云端重设后才能登录', 401, 'password-reset-required');
    }
    throw fault('邮箱或密码不正确', 401);
  }
  const membership = await db.prepare('SELECT workspace_id FROM memberships WHERE user_id=? LIMIT 1').bind(row.id).first<{ workspace_id: string }>();
  if (!membership) throw fault('账号没有可用空间', 409);
  assertWorkspaceId(membership.workspace_id);
  const workspace = await db.prepare('SELECT name FROM workspaces WHERE id=?').bind(membership.workspace_id).first<{ name: string }>();
  const token = await issueSession(db, row.id, membership.workspace_id);
  return { token, account: { userId: row.id, workspaceId: membership.workspace_id, email: row.email, name: row.name, workspaceName: workspace?.name ?? '' } };
}

/** Constructed only from a verified server-side session, never from request JSON. */
export async function identify(db: D1Database, token: string): Promise<Account> {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw fault('请先登录', 401);
  const row = await db.prepare(`SELECT u.id,u.email,u.name,s.workspace_id,w.name AS workspace_name
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id
    JOIN workspaces w ON w.id=s.workspace_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await tokenDigest(token), Date.now()).first<{
      id: string; email: string; name: string; workspace_id: string; workspace_name: string;
    }>();
  if (!row) throw fault('登录已失效，请重新登录', 401);
  assertWorkspaceId(row.workspace_id);
  return { userId: row.id, workspaceId: row.workspace_id, email: row.email, name: row.name, workspaceName: row.workspace_name };
}

export async function logout(db: D1Database, token: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) return;
  await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await tokenDigest(token)).run();
}

export const SESSION_COOKIE = 'pi_session';

export function readSessionToken(request: Request): string {
  const cookie = request.headers.get('Cookie') ?? '';
  const found = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  return found ? found.slice(SESSION_COOKIE.length + 1) : '';
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
