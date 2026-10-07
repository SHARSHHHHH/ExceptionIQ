import { getDb, transaction, type DB } from '../db';
import { clock } from '../config';
import { Actor, DomainError } from '../domain/types';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../security/rbac';
import { SERVICE_ACTORS } from '../security/session';
import { attachToCaseGraph } from '../graph/evidence';
import { policyVersion } from '../rules/discountPolicy';
import { hashOf, newId, parseJson, sha256 } from '../util';
import { CaseRow, getCaseRow, loadCaseFor, recordDenial, transition } from './cases';
import { ApprovalRow, getProposal, staleEvidence } from './approvals';
import { verifyExecution } from './verify';

interface Payload {
  action: string; entity_id: string; currency: string; bank_txn_id: string; invoice_id: string; open_item_id: string;
  discount_minor: number; match_amount_minor: number; expected_residual_after_minor: number;
  journal: { memo: string; lines: { account: string; name: string; debit_minor: number; credit_minor: number }[] };
}

export const idempotencyKeyFor = (proposalId: string, payloadHash: string) => sha256(`exec:${proposalId}:${payloadHash}`);

/**
 * Restricted executor (idea doc §6 step 7). Runs as the executor service identity and re-checks
 * EVERYTHING itself — it trusts neither the UI, the model, nor the approval screen:
 * approval exists and is unexpired; payload/evidence/policy hashes match the binding; evidence is fresh;
 * separation of duties still holds. The write is atomic and idempotent.
 */
export function executeProposal(caseId: string, proposalId: string, actor: Actor) {
  const db = getDb();
  let kase = loadCaseFor(db, actor, caseId);
  const exec = SERVICE_ACTORS.executor;
  try { requirePermission(actor, 'execution:trigger'); } catch (e) { recordDenial(db, kase, actor, 'resolution.apply_mock_adjustment', 'FORBIDDEN', (e as Error).message); }

  const p = getProposal(db, proposalId);
  if (!p || p.case_id !== caseId) throw new DomainError('NOT_FOUND', 'Proposal not found for this case', 404);

  // Idempotency: a repeated request returns the original result; a failed attempt is never blindly retried.
  const key = idempotencyKeyFor(p.id, p.payload_hash);
  const prior = db.prepare('SELECT * FROM executions WHERE idempotency_key=?').get(key) as { id: string; status: string } | undefined;
  if (prior?.status === 'SUCCEEDED') {
    appendAudit(db, { caseId, entityId: kase.entity_id, actor, type: 'EXECUTION_IDEMPOTENT_REPLAY', correlationId: prior.id, summary: `Repeat request for ${p.id} returned existing execution ${prior.id}; no new write`, data: { idempotencyKey: key } });
    return { executionId: prior.id, replayed: true, status: getCaseRow(db, caseId)!.status };
  }
  if (prior?.status === 'FAILED') recordDenial(db, kase, actor, 'resolution.apply_mock_adjustment', 'PREVIOUS_ATTEMPT_FAILED', 'A previous attempt failed; blind retry is not permitted. Re-investigate and obtain a new approval.', 409);

  const deny = (code: string, reason: string, toReview = false): never => {
    if (toReview && kase.status === 'APPROVED') {
      db.prepare("UPDATE proposals SET status='SUPERSEDED' WHERE id=?").run(p.id);
      kase = transition(db, kase, 'NEEDS_REVIEW', exec, `${code}: ${reason}`);
    }
    return recordDenial(db, kase, actor, 'resolution.apply_mock_adjustment', code, reason, 409);
  };

  if (p.status === 'PENDING_APPROVAL') deny('NOT_APPROVED', 'Proposal has no controller approval. Writes require an explicit, valid approval.');
  if (p.status !== 'APPROVED') deny('PROPOSAL_NOT_EXECUTABLE', `Proposal status is ${p.status}`);
  if (kase.status !== 'APPROVED') deny('CASE_NOT_APPROVED', `Case status is ${kase.status}`);
  const a = db.prepare("SELECT * FROM approvals WHERE proposal_id=? ORDER BY decided_at DESC LIMIT 1").get(p.id) as ApprovalRow | undefined;
  if (!a || a.decision !== 'APPROVED') deny('NOT_APPROVED', 'No approval record found for this proposal');
  const approval = a!;
  if (approval.approver_id === p.proposed_by) deny('SEPARATION_OF_DUTIES', 'Approver and proposer are the same identity');
  if (hashOf(JSON.parse(p.payload)) !== approval.payload_hash || p.payload_hash !== approval.payload_hash) deny('PAYLOAD_CHANGED', 'Payload differs from the approved payload', true);
  if (p.evidence_hash !== approval.evidence_hash) deny('EVIDENCE_BINDING_MISMATCH', 'Proposal evidence differs from approved evidence', true);
  // The approver must STILL hold authority for this amount (role, active flag and limit are re-read now).
  const approver = db.prepare('SELECT role, active, approval_limit_minor FROM users WHERE id=?').get(approval.approver_id) as { role: string; active: number; approval_limit_minor: number } | undefined;
  const approvedAmount = Number(parseJson<{ discount_minor?: number }>(p.payload, {}).discount_minor ?? 0);
  if (!approver || approver.role !== 'CONTROLLER' || !approver.active || approver.approval_limit_minor < approvedAmount) {
    deny('APPROVER_AUTHORITY_REVOKED', 'The approving controller no longer holds authority for this amount; a new approval is required', true);
  }
  if (approval.policy_version !== policyVersion()) deny('POLICY_CHANGED', `Approved under ${approval.policy_version}; current ${policyVersion()}`, true);
  if (new Date(approval.expires_at).getTime() <= clock.now().getTime()) deny('APPROVAL_EXPIRED', `Approval expired at ${approval.expires_at}`, true);
  const changed = staleEvidence(db, p.evidence_manifest);
  if (changed.length) deny('EVIDENCE_CHANGED', `Source records changed after approval: ${changed.join(', ')}`, true);

  const payload = JSON.parse(p.payload) as Payload;
  const faults = parseJson<{ write_fail?: boolean; verify_fail?: boolean }>(kase.faults, {});
  kase = transition(db, kase, 'EXECUTING', exec, `Executing ${p.id} under approval ${approval.id}`);
  const executionId = newId('EXE');
  const startedAt = clock.now().toISOString();
  let before: Record<string, unknown> = {};

  try {
    transaction(db, () => {
      const oi = db.prepare('SELECT * FROM erp_open_items WHERE id=?').get(payload.open_item_id) as Record<string, number | string>;
      before = { open_item: { ...oi }, matches_for_bank_txn: db.prepare('SELECT COUNT(*) AS n FROM payment_matches WHERE bank_txn_id=?').get(payload.bank_txn_id) };
      // Fresh preconditions inside the transaction.
      if (!oi || oi.status !== 'OPEN') throw new Error(`Precondition failed: open item ${payload.open_item_id} is not OPEN`);
      if (Number(oi.residual_minor) !== payload.discount_minor) throw new Error(`Precondition failed: residual ${oi.residual_minor} ≠ approved discount ${payload.discount_minor}`);
      if (db.prepare('SELECT 1 FROM payment_matches WHERE bank_txn_id=? OR invoice_id=?').get(payload.bank_txn_id, payload.invoice_id)) throw new Error('Precondition failed: payment already matched');
      const dr = payload.journal.lines.reduce((s, l) => s + l.debit_minor, 0);
      const cr = payload.journal.lines.reduce((s, l) => s + l.credit_minor, 0);
      if (dr !== cr || dr !== payload.discount_minor) throw new Error('Journal is not balanced to the approved discount');

      const now = clock.now().toISOString();
      db.prepare('INSERT INTO ledger_journals VALUES (?,?,?,?,?,?,?)').run(newId('JNL'), payload.entity_id, executionId, payload.invoice_id, JSON.stringify(payload.journal.lines), payload.journal.memo, now);
      if (faults.write_fail) throw new Error('Simulated ledger connector failure after journal insert (fault injection)');
      db.prepare('INSERT INTO payment_matches VALUES (?,?,?,?,?,?,?)').run(newId('M'), payload.entity_id, payload.bank_txn_id, payload.invoice_id, payload.match_amount_minor, executionId, now);
      db.prepare(`UPDATE erp_open_items SET residual_minor=0, discount_adjusted=1, status='CLEARED', version=version+1, updated_at=? WHERE id=?`).run(now, payload.open_item_id);
    });
  } catch (e) {
    const error = (e as Error).message;
    db.prepare(`INSERT INTO executions VALUES (?,?,?,?,?, 'FAILED', ?, NULL, ?, ?, ?, ?)`).run(executionId, p.id, caseId, approval.id, key, JSON.stringify(before), error, actor.id, startedAt, clock.now().toISOString());
    db.prepare("UPDATE proposals SET status='FAILED' WHERE id=?").run(p.id);
    appendAudit(db, { caseId, entityId: kase.entity_id, actor: exec, type: 'EXECUTION_FAILED', correlationId: executionId, summary: `Write failed and was rolled back: ${error}`, data: { executionId, idempotencyKey: key, error, triggeredBy: actor.id } });
    attachToCaseGraph(db, caseId, 'Action', 'Mock write FAILED (rolled back)', 'Approval', 'authorized_by', { refId: executionId, status: 'FAILED', data: { error } });
    kase = transition(db, getCaseRow(db, caseId)!, 'NEEDS_REVIEW', exec, `Execution failed; transaction rolled back, no partial write. ${error}. Do not retry blindly — re-investigate.`);
    return { executionId, replayed: false, status: kase.status, error };
  }

  const after = { open_item: db.prepare('SELECT * FROM erp_open_items WHERE id=?').get(payload.open_item_id) };
  db.prepare(`INSERT INTO executions VALUES (?,?,?,?,?, 'SUCCEEDED', ?, ?, NULL, ?, ?, ?)`).run(executionId, p.id, caseId, approval.id, key, JSON.stringify(before), JSON.stringify(after), actor.id, startedAt, clock.now().toISOString());
  appendAudit(db, { caseId, entityId: kase.entity_id, actor: exec, type: 'EXECUTION_SUCCEEDED', correlationId: executionId,
    summary: `Applied ${p.id} once (journal + match + open item cleared)`, data: { executionId, approvalId: approval.id, idempotencyKey: key, triggeredBy: actor.id } });
  attachToCaseGraph(db, caseId, 'Action', `Mock adjustment applied (${executionId})`, 'Approval', 'authorized_by', { refId: executionId, status: 'SUCCEEDED' });

  if (faults.verify_fail) simulateExternalReopen(db, kase, payload.open_item_id, payload.discount_minor);

  kase = transition(db, getCaseRow(db, caseId)!, 'VERIFYING', exec, 'Write committed; independent verification started');
  const verification = verifyExecution(executionId);
  return { executionId, replayed: false, status: verification.status, verification };
}

/** Fault injection for the VERIFY_FAILURE scenario: an external ERP process reopens the residual. */
function simulateExternalReopen(db: DB, kase: CaseRow, openItemId: string, amount: number) {
  db.prepare(`UPDATE erp_open_items SET residual_minor=?, status='OPEN', version=version+1, updated_at=? WHERE id=?`).run(amount, clock.now().toISOString(), openItemId);
  appendAudit(db, { caseId: kase.id, entityId: kase.entity_id, actor: { id: 'ext-erp', name: 'External ERP (simulated)', role: 'SERVICE', entityIds: [] },
    type: 'EXTERNAL_SOURCE_CHANGE', summary: `Simulated external ERP reversal reopened ${openItemId}`, data: { openItemId, residualMinor: amount, faultInjection: true } });
}
