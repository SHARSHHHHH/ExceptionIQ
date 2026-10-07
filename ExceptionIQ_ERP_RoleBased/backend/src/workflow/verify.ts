import { getDb } from '../db';
import { clock } from '../config';
import { appendAudit } from '../audit/audit';
import { SERVICE_ACTORS } from '../security/session';
import { attachToCaseGraph } from '../graph/evidence';
import { newId } from '../util';
import { getCaseRow, transition } from './cases';

export interface VerificationCheck { id: string; label: string; passed: boolean; expected: unknown; actual: unknown }

/**
 * Independent postcondition check (idea doc §6 step 8). Reads source tables directly; never trusts the
 * executor's response. Closes the case only when every check passes; otherwise routes to review with guidance.
 */
export function verifyExecution(executionId: string) {
  const db = getDb();
  const ver = SERVICE_ACTORS.verifier;
  const exe = db.prepare('SELECT * FROM executions WHERE id=?').get(executionId) as { id: string; proposal_id: string; case_id: string; status: string };
  const proposal = db.prepare('SELECT * FROM proposals WHERE id=?').get(exe.proposal_id) as { payload: string };
  const p = JSON.parse(proposal.payload) as { open_item_id: string; bank_txn_id: string; invoice_id: string; discount_minor: number; match_amount_minor: number };

  const oi = db.prepare('SELECT * FROM erp_open_items WHERE id=?').get(p.open_item_id) as { residual_minor: number; status: string; discount_adjusted: number };
  const bankMatches = db.prepare('SELECT * FROM payment_matches WHERE bank_txn_id=?').all(p.bank_txn_id) as { invoice_id: string; amount_minor: number }[];
  const invMatches = db.prepare('SELECT * FROM payment_matches WHERE invoice_id=?').all(p.invoice_id) as unknown[];
  const journals = db.prepare('SELECT * FROM ledger_journals WHERE execution_id=?').all(executionId) as { lines: string }[];
  const lines = journals.length === 1 ? (JSON.parse(journals[0].lines) as { debit_minor: number; credit_minor: number }[]) : [];
  const dr = lines.reduce((s, l) => s + l.debit_minor, 0);
  const cr = lines.reduce((s, l) => s + l.credit_minor, 0);

  const checks: VerificationCheck[] = [
    { id: 'V1', label: 'Open item residual is zero', passed: oi?.residual_minor === 0, expected: 0, actual: oi?.residual_minor },
    { id: 'V2', label: 'Open item status is CLEARED', passed: oi?.status === 'CLEARED', expected: 'CLEARED', actual: oi?.status },
    { id: 'V3', label: 'Discount adjustment flag set', passed: oi?.discount_adjusted === 1, expected: 1, actual: oi?.discount_adjusted },
    { id: 'V4', label: 'Exactly one match for the bank transaction, to the approved invoice and amount',
      passed: bankMatches.length === 1 && bankMatches[0].invoice_id === p.invoice_id && bankMatches[0].amount_minor === p.match_amount_minor,
      expected: `1 × ${p.invoice_id} @ ${p.match_amount_minor}`, actual: bankMatches.map((m) => `${m.invoice_id} @ ${m.amount_minor}`) },
    { id: 'V5', label: 'Invoice has a unique payment link', passed: invMatches.length === 1, expected: 1, actual: invMatches.length },
    { id: 'V6', label: 'Exactly one balanced journal equal to the approved discount', passed: journals.length === 1 && dr === cr && dr === p.discount_minor,
      expected: { journals: 1, debit: p.discount_minor, credit: p.discount_minor }, actual: { journals: journals.length, debit: dr, credit: cr } },
  ];
  const passed = checks.every((c) => c.passed);
  const guidance = passed ? null
    : 'The approved write committed, but postconditions do not hold. Do NOT retry the action. A controller should reconcile the current ERP state ' +
      '(see failed checks), and if required post a compensating reversal of the journal through a new approved proposal.';
  const vid = newId('VER');
  db.prepare('INSERT INTO verifications VALUES (?,?,?,?,?,?,?)').run(vid, exe.case_id, executionId, passed ? 1 : 0, JSON.stringify(checks), guidance, clock.now().toISOString());
  const kase = getCaseRow(db, exe.case_id)!;
  appendAudit(db, { caseId: kase.id, entityId: kase.entity_id, actor: ver, type: passed ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED', correlationId: vid,
    summary: passed ? 'All postconditions verified by independent re-read' : `Verification failed: ${checks.filter((c) => !c.passed).map((c) => c.id).join(', ')}`,
    data: { executionId, checks: checks.map((c) => ({ id: c.id, passed: c.passed, actual: c.actual })) } });
  attachToCaseGraph(db, kase.id, 'Verification', passed ? 'Verified: zero residual, unique match' : 'Verification FAILED', 'Action', 'verified_by', { refId: vid, status: passed ? 'PASSED' : 'FAILED' });

  if (passed) {
    db.prepare("UPDATE proposals SET status='EXECUTED' WHERE id=?").run(exe.proposal_id);
    const closed = transition(db, kase, 'CLOSED', ver, 'Closed after verified success');
    return { verificationId: vid, passed, checks, status: closed.status };
  }
  const reviewed = transition(db, kase, 'NEEDS_REVIEW', ver, `Verification failed (${checks.filter((c) => !c.passed).map((c) => c.label).join('; ')}). ${guidance}`);
  return { verificationId: vid, passed, checks, guidance, status: reviewed.status };
}
