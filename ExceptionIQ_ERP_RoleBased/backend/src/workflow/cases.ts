import type { DB } from '../db';
import { clock } from '../config';
import { assertTransition } from '../domain/stateMachine';
import { Actor, CaseStatus, DomainError } from '../domain/types';
import { appendAudit } from '../audit/audit';
import { requireEntity, requirePermission } from '../security/rbac';
import { getDb } from '../db';
import { newId } from '../util';

export interface CaseRow {
  id: string; entity_id: string; scenario: string; source_event_key: string; bank_txn_id: string; title: string;
  status: CaseStatus; risk_class: string | null; residual_minor: number | null; currency: string | null; root_cause: string | null;
  explanation: string | null; status_reason: string | null; faults: string; investigated_by: string | null; created_by: string;
  created_at: string; updated_at: string; version: number; assigned_to: string | null; source: string; exception_type: string | null;
}

export function getCaseRow(db: DB, id: string): CaseRow | undefined {
  return db.prepare('SELECT * FROM cases WHERE id=?').get(id) as CaseRow | undefined;
}

/** Load a case enforcing the entity boundary; out-of-scope cases are indistinguishable from missing ones. */
export function loadCaseFor(db: DB, actor: Actor, id: string): CaseRow {
  const row = getCaseRow(db, id);
  if (!row) throw new DomainError('NOT_FOUND', 'Case not found', 404);
  if (actor.role !== 'SERVICE') requireEntity(actor, row.entity_id);
  return row;
}

/** State transition with optimistic concurrency and an audit event. Returns the refreshed row. */
export function transition(db: DB, kase: CaseRow, to: CaseStatus, actor: Actor, reason: string, patch: Partial<CaseRow> = {}): CaseRow {
  assertTransition(kase.status, to);
  const fields = { ...patch, status: to, status_reason: reason, updated_at: clock.now().toISOString() } as Record<string, unknown>;
  const sets = Object.keys(fields).map((k) => `${k}=@${k}`).join(', ');
  const res = db.prepare(`UPDATE cases SET ${sets}, version=version+1 WHERE id=@id AND version=@expected`).run({ ...fields, id: kase.id, expected: kase.version });
  if (res.changes !== 1) throw new DomainError('CONCURRENT_MODIFICATION', 'Case changed concurrently; reload and retry', 409);
  appendAudit(db, { caseId: kase.id, entityId: kase.entity_id, actor, type: 'CASE_STATUS_CHANGED', summary: `${kase.status} → ${to}: ${reason}`, data: { from: kase.status, to, reason } });
  return getCaseRow(db, kase.id)!;
}

export function updateCaseFields(db: DB, kase: CaseRow, patch: Partial<CaseRow>): CaseRow {
  const fields = { ...patch, updated_at: clock.now().toISOString() } as Record<string, unknown>;
  const sets = Object.keys(fields).map((k) => `${k}=@${k}`).join(', ');
  const res = db.prepare(`UPDATE cases SET ${sets}, version=version+1 WHERE id=@id AND version=@expected`).run({ ...fields, id: kase.id, expected: kase.version });
  if (res.changes !== 1) throw new DomainError('CONCURRENT_MODIFICATION', 'Case changed concurrently; reload and retry', 409);
  return getCaseRow(db, kase.id)!;
}

export function recordDenial(db: DB, kase: CaseRow | null, actor: Actor, action: string, code: string, reason: string, httpStatus = 403): never {
  db.prepare('INSERT INTO denied_actions VALUES (?,?,?,?,?,?,?)').run(`DEN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
    kase?.id ?? null, actor.id, action, code, reason, clock.now().toISOString());
  appendAudit(db, { caseId: kase?.id, entityId: kase?.entity_id, actor, type: 'ACTION_DENIED', summary: `${action} denied: ${code}`, data: { action, code, reason } });
  throw new DomainError(code, reason, httpStatus);
}

/** Statuses in which a case still has investigation work and can be (re)assigned. */
const ASSIGNABLE = new Set<CaseStatus>(['OPEN', 'NEEDS_REVIEW', 'BLOCKED', 'INVESTIGATING']);

/**
 * Ownership rule used by investigation: an analyst may work a case that is unassigned (it is claimed for them)
 * or assigned to them. A case assigned to another analyst is refused, so two people never work the same case.
 */
export function ensureOwnership(db: DB, kase: CaseRow, actor: Actor): CaseRow {
  if (kase.assigned_to && kase.assigned_to !== actor.id) {
    const owner = db.prepare('SELECT name FROM users WHERE id=?').get(kase.assigned_to) as { name: string } | undefined;
    recordDenial(db, kase, actor, 'case.investigate', 'CASE_ASSIGNED_TO_OTHER', `Case is assigned to ${owner?.name ?? kase.assigned_to}. Ask a controller to reassign it.`, 403);
  }
  if (!kase.assigned_to) {
    kase = updateCaseFields(db, kase, { assigned_to: actor.id });
    appendAudit(db, { caseId: kase.id, entityId: kase.entity_id, actor, type: 'CASE_CLAIMED', summary: `${actor.name} claimed the case` });
  }
  return kase;
}

export function claimCase(caseId: string, actor: Actor) {
  const db = getDb();
  requirePermission(actor, 'case:claim');
  const kase = loadCaseFor(db, actor, caseId);
  if (!ASSIGNABLE.has(kase.status)) throw new DomainError('INVALID_STATE', `A ${kase.status} case cannot be claimed`, 409);
  if (kase.assigned_to === actor.id) return { assignedTo: actor.id };
  if (kase.assigned_to) recordDenial(db, kase, actor, 'case.claim', 'CASE_ASSIGNED_TO_OTHER', 'Case already has an owner; a controller must reassign it', 409);
  ensureOwnership(db, kase, actor);
  return { assignedTo: actor.id };
}

/** Controllers distribute work. The assignee must be an active analyst with access to the case's entity. */
export function assignCase(caseId: string, assigneeId: string | null, actor: Actor) {
  const db = getDb();
  requirePermission(actor, 'case:assign');
  let kase = loadCaseFor(db, actor, caseId);
  if (!ASSIGNABLE.has(kase.status)) throw new DomainError('INVALID_STATE', `A ${kase.status} case cannot be reassigned`, 409);
  if (assigneeId) {
    const u = db.prepare('SELECT id, name, role, entity_ids, active FROM users WHERE id=?').get(assigneeId) as { id: string; name: string; role: string; entity_ids: string; active: number } | undefined;
    if (!u || !u.active) throw new DomainError('NOT_FOUND', 'Assignee not found', 404);
    if (u.role !== 'ANALYST') throw new DomainError('INVALID_ASSIGNEE', 'Only reconciliation analysts can own an investigation', 400);
    if (!(JSON.parse(u.entity_ids) as string[]).includes(kase.entity_id)) throw new DomainError('INVALID_ASSIGNEE', `${u.name} has no access to entity ${kase.entity_id}`, 400);
  }
  const from = kase.assigned_to;
  kase = updateCaseFields(db, kase, { assigned_to: assigneeId });
  appendAudit(db, { caseId, entityId: kase.entity_id, actor, type: 'CASE_ASSIGNED', summary: assigneeId ? `Assigned to ${assigneeId}${from ? ` (was ${from})` : ''}` : `Unassigned (was ${from ?? 'nobody'})`, data: { from, to: assigneeId } });
  return { assignedTo: assigneeId };
}

export function addNote(caseId: string, body: string, actor: Actor) {
  const db = getDb();
  requirePermission(actor, 'case:comment');
  const kase = loadCaseFor(db, actor, caseId);
  const text = body.trim();
  if (text.length < 2) throw new DomainError('VALIDATION_FAILED', 'Note is empty', 400);
  const id = newId('NOTE');
  const now = clock.now().toISOString();
  db.prepare('INSERT INTO case_notes VALUES (?,?,?,?,?,?)').run(id, caseId, actor.id, actor.role, text, now);
  appendAudit(db, { caseId, entityId: kase.entity_id, actor, type: 'NOTE_ADDED', correlationId: id, summary: `${actor.name} added a note`, data: { length: text.length } });
  return { id, created_at: now };
}
