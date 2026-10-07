import { getDb, transaction, type DB } from '../db';
import { clock, config } from '../config';
import { Actor, DomainError } from '../domain/types';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../security/rbac';
import { SERVICE_ACTORS } from '../security/session';
import { attachToCaseGraph } from '../graph/evidence';
import { policyVersion } from '../rules/discountPolicy';
import { sources } from '../tools/sources';
import { hashOf, newId, parseJson } from '../util';
import { formatMinor } from '../domain/money';
import { loadCaseFor, recordDenial, transition } from './cases';

export interface ProposalRow {
  id: string; case_id: string; run_no: number; action: string; payload: string; payload_hash: string; evidence_manifest: string;
  evidence_hash: string; policy_version: string; risk_class: string; status: string; proposed_by: string; created_at: string;
}
export interface ApprovalRow {
  id: string; proposal_id: string; case_id: string; approver_id: string; decision: 'APPROVED' | 'REJECTED'; reason: string | null;
  payload_hash: string; evidence_hash: string; policy_version: string; decided_at: string; expires_at: string;
}

export function getProposal(db: DB, id: string): ProposalRow | undefined {
  return db.prepare('SELECT * FROM proposals WHERE id=?').get(id) as ProposalRow | undefined;
}

/** Re-read every record in the evidence manifest; returns the list of records whose version/hash changed. */
export function staleEvidence(db: DB, manifestJson: string): string[] {
  const manifest = JSON.parse(manifestJson) as { table: string; id: string; version: number; hash: string }[];
  const changed: string[] = [];
  for (const m of manifest) {
    const now = sources.reread(db, m.table, m.id);
    if (!now || now.version !== m.version || now.hash !== m.hash) changed.push(`${m.id} (v${m.version}→${now ? `v${now.version}` : 'missing'})`);
  }
  return changed;
}

/**
 * Controller decision on the EXACT proposal payload. The approval binds payload hash, evidence hash
 * and policy version, and expires. Separation of duties: the investigating analyst can never approve,
 * and only CONTROLLER role holds approval:decide (administrators do not).
 */
export function decideProposal(caseId: string, proposalId: string, decision: 'APPROVED' | 'REJECTED', reason: string | undefined, actor: Actor) {
  const db = getDb();
  const kase0 = loadCaseFor(db, actor, caseId);
  try { requirePermission(actor, 'approval:decide'); } catch (e) { recordDenial(db, kase0, actor, 'approval.decide', 'FORBIDDEN', (e as Error).message, 403); }
  let kase = kase0;
  const p = getProposal(db, proposalId);
  if (!p || p.case_id !== caseId) throw new DomainError('NOT_FOUND', 'Proposal not found for this case', 404);
  if (kase.status !== 'AWAITING_APPROVAL' || p.status !== 'PENDING_APPROVAL') {
    throw new DomainError('APPROVAL_GATE_CLOSED', `Proposal is ${p.status} and case is ${kase.status}; nothing to decide`, 409);
  }
  if (actor.id === p.proposed_by || actor.id === kase.investigated_by) {
    recordDenial(db, kase, actor, 'approval.decide', 'SEPARATION_OF_DUTIES', 'The investigator/proposer cannot approve their own proposal', 403);
  }
  // Delegation of authority: approving needs a limit at least as large as the adjustment. Anyone may reject.
  const payload = parseJson<{ discount_minor?: number; currency?: string }>(p.payload, {});
  const amount = Number(payload.discount_minor ?? 0);
  const limit = actor.approvalLimitMinor ?? 0;
  if (decision === 'APPROVED' && amount > limit) {
    const cur = payload.currency ?? 'INR';
    recordDenial(db, kase, actor, 'approval.decide', 'APPROVAL_LIMIT_EXCEEDED',
      `Adjustment of ${formatMinor(amount, cur)} exceeds your approval limit of ${formatMinor(limit, cur)}. Route it to a controller with a higher limit.`, 403);
  }
  if (decision === 'REJECTED' && (!reason || reason.trim().length < 5)) throw new DomainError('REASON_REQUIRED', 'A rejection reason (min 5 characters) is required', 400);
  if (hashOf(JSON.parse(p.payload)) !== p.payload_hash) {
    recordDenial(db, kase, actor, 'approval.decide', 'PAYLOAD_INTEGRITY', 'Stored payload does not match its hash', 409);
  }

  // Evidence must still be what the proposal was built on.
  const changed = staleEvidence(db, p.evidence_manifest);
  if (changed.length || p.policy_version !== policyVersion()) {
    db.prepare("UPDATE proposals SET status='SUPERSEDED' WHERE id=?").run(p.id);
    const why = changed.length ? `Evidence changed since proposal: ${changed.join(', ')}` : `Policy changed: ${p.policy_version} → ${policyVersion()}`;
    transition(db, kase, 'NEEDS_REVIEW', SERVICE_ACTORS.agent, `${why}. Re-investigation required.`);
    throw new DomainError('EVIDENCE_CHANGED', why, 409);
  }

  const now = clock.now();
  const approval: ApprovalRow = {
    id: newId('APR'), proposal_id: p.id, case_id: caseId, approver_id: actor.id, decision, reason: reason?.trim() || null,
    payload_hash: p.payload_hash, evidence_hash: p.evidence_hash, policy_version: p.policy_version,
    decided_at: now.toISOString(), expires_at: new Date(now.getTime() + config.approvalTtlMinutes * 60_000).toISOString(),
  };
  transaction(db, () => {
    db.prepare('INSERT INTO approvals VALUES (@id,@proposal_id,@case_id,@approver_id,@decision,@reason,@payload_hash,@evidence_hash,@policy_version,@decided_at,@expires_at)').run({ ...approval });
    db.prepare('UPDATE proposals SET status=? WHERE id=?').run(decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', p.id);
    appendAudit(db, { caseId, entityId: kase.entity_id, actor, type: decision === 'APPROVED' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED', correlationId: approval.id,
      summary: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} ${p.id}${reason ? `: ${reason}` : ''}`,
      data: { approvalId: approval.id, proposalId: p.id, amountMinor: amount, approverLimitMinor: limit, payloadHash: p.payload_hash, evidenceHash: p.evidence_hash, policyVersion: p.policy_version, expiresAt: approval.expires_at } });
    attachToCaseGraph(db, caseId, 'Approval', `${decision} by ${actor.name}`, 'Proposal', 'authorized_by', { refId: approval.id, status: decision, data: { reason: approval.reason, expiresAt: approval.expires_at } });
    kase = decision === 'APPROVED'
      ? transition(db, kase, 'APPROVED', actor, `Approved by ${actor.name}; binding expires ${approval.expires_at}`)
      : transition(db, kase, 'NEEDS_REVIEW', actor, `Rejected by ${actor.name}: ${approval.reason}`);
  });
  return { approval, status: kase.status };
}
