import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, clock } from '../config';
import { Actor, DomainError } from '../domain/types';
import { getDb } from '../db';
import { parseJson } from '../util';
import { verifyPassword } from './passwords';

interface TokenPayload { sub: string; exp: number }

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (data: string) => createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

export function issueToken(userId: string): string {
  const payload: TokenPayload = { sub: userId, exp: clock.now().getTime() + config.sessionTtlMinutes * 60_000 };
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const payload = parseJson<TokenPayload | null>(Buffer.from(body, 'base64url').toString(), null);
  if (!payload || payload.exp < clock.now().getTime()) return null;
  return payload;
}

export interface UserRow { id: string; email: string; name: string; role: Actor['role']; entity_ids: string; password_hash: string;
  title: string; approval_limit_minor: number; active: number }

export function actorFromUser(row: UserRow): Actor {
  return { id: row.id, name: row.name, role: row.role, entityIds: JSON.parse(row.entity_ids), approvalLimitMinor: row.approval_limit_minor ?? 0, title: row.title ?? '' };
}

export function login(email: string, password: string): { token: string; actor: Actor; email: string } {
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  if (!row.active) throw new DomainError('ACCOUNT_DISABLED', 'This account has been deactivated by an administrator', 403);
  return { token: issueToken(row.id), actor: actorFromUser(row), email: row.email };
}

export function actorFromToken(token: string | null | undefined): Actor {
  const payload = token ? verifyToken(token) : null;
  if (!payload) throw new DomainError('UNAUTHENTICATED', 'Sign in required', 401);
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as UserRow | undefined;
  if (!row) throw new DomainError('UNAUTHENTICATED', 'Unknown user', 401);
  // Role, entity scope, limit and active flag are re-read on every request, so admin changes apply immediately.
  if (!row.active) throw new DomainError('UNAUTHENTICATED', 'Account deactivated', 401);
  return actorFromUser(row);
}

/** Service identities never come from a login; they are constructed server-side only. */
export const SERVICE_ACTORS = {
  ingest: { id: 'svc-ingest', name: 'Event ingestion service', role: 'SERVICE', entityIds: ['*'] } as Actor,
  agent: { id: 'svc-agent', name: 'Investigation agent', role: 'SERVICE', entityIds: ['*'] } as Actor,
  executor: { id: 'svc-executor', name: 'Restricted executor', role: 'SERVICE', entityIds: ['*'] } as Actor,
  verifier: { id: 'svc-verifier', name: 'Independent verifier', role: 'SERVICE', entityIds: ['*'] } as Actor,
};
