import type { DB } from '../db';
import { clock } from '../config';
import { Actor } from '../domain/types';
import { canonicalJson, newId, sha256 } from '../util';
import { redactDeep } from '../security/redaction';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  caseId?: string | null;
  entityId?: string | null;
  actor: Actor;
  type: string;
  summary: string;
  correlationId?: string | null;
  data?: Record<string, unknown>;
}

export interface AuditEvent {
  seq: number; id: string; case_id: string | null; entity_id: string | null; actor_id: string; actor_role: string;
  event_type: string; correlation_id: string | null; summary: string; data: string; prev_hash: string; hash: string; created_at: string;
}

function eventHash(e: Omit<AuditEvent, 'seq' | 'hash'>): string {
  return sha256(canonicalJson({ ...e, prev: e.prev_hash }));
}

/**
 * Append an event to the hash-chained, append-only audit log.
 * Each event's hash covers its content and the previous event's hash, so any edit, deletion or
 * reordering breaks verification. (Triggers additionally block UPDATE/DELETE at the database layer.)
 */
export function appendAudit(db: DB, input: AuditInput): AuditEvent {
  const last = db.prepare('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
  const base = {
    id: newId('AUD'),
    case_id: input.caseId ?? null,
    entity_id: input.entityId ?? null,
    actor_id: input.actor.id,
    actor_role: input.actor.role,
    event_type: input.type,
    correlation_id: input.correlationId ?? null,
    summary: input.summary,
    data: canonicalJson(redactDeep(input.data ?? {})),
    prev_hash: last?.hash ?? GENESIS_HASH,
    created_at: clock.now().toISOString(),
  };
  const hash = eventHash(base);
  const info = db.prepare(`INSERT INTO audit_events (id, case_id, entity_id, actor_id, actor_role, event_type, correlation_id, summary, data, prev_hash, hash, created_at)
    VALUES (@id, @case_id, @entity_id, @actor_id, @actor_role, @event_type, @correlation_id, @summary, @data, @prev_hash, @hash, @created_at)`).run({ ...base, hash });
  return { ...base, hash, seq: Number(info.lastInsertRowid) };
}

export interface ChainVerification { valid: boolean; checked: number; brokenAtSeq: number | null; headHash: string }

export function verifyAuditChain(db: DB): ChainVerification {
  const rows = db.prepare('SELECT * FROM audit_events ORDER BY seq ASC').all() as unknown as AuditEvent[];
  let prev = GENESIS_HASH;
  for (const r of rows) {
    const { seq, hash, ...rest } = r;
    if (r.prev_hash !== prev || eventHash(rest) !== hash) return { valid: false, checked: rows.length, brokenAtSeq: seq, headHash: prev };
    prev = hash;
  }
  return { valid: true, checked: rows.length, brokenAtSeq: null, headHash: prev };
}
