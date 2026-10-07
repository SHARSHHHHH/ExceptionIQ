import { getDb } from '../db';
import { Actor } from '../domain/types';
import { can, requirePermission } from '../security/rbac';
import { formatMinor } from '../domain/money';
import { verifyAuditChain } from '../audit/audit';
import { SCENARIOS } from '../fixtures/scenarios';
import { parseJson } from '../util';
import { loadCaseFor } from './cases';

/** Read-model rows are plain DB records; DTO typing is intentionally loose here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const scenarioOf = (key: string) => SCENARIOS.find((s) => s.key === key);
const TYPE_LABEL: Record<string, string> = {
  SHORT_PAYMENT: 'Short payment', OVER_PAYMENT: 'Over payment', NO_MATCH: 'No matching invoice', DUPLICATE_PAYMENT: 'Duplicate payment',
  CURRENCY_MISMATCH: 'Currency mismatch', BENEFICIARY_MISMATCH: 'Beneficiary mismatch',
};
const titleOf = (r: Row) => scenarioOf(String(r.scenario))?.title ?? TYPE_LABEL[String(r.exception_type)] ?? String(r.scenario);
const INVESTIGABLE = ['OPEN', 'NEEDS_REVIEW', 'BLOCKED'];
const ASSIGNABLE = [...INVESTIGABLE, 'INVESTIGATING'];

export function listCases(actor: Actor) {
  requirePermission(actor, 'case:read');
  const db = getDb();
  const rows = db.prepare(`SELECT c.*, b.amount_minor AS paid_minor, b.counterparty_name AS vendor_name, b.value_date, u.name AS assigned_to_name,
      (SELECT id FROM proposals p WHERE p.case_id=c.id AND p.status IN ('PENDING_APPROVAL','APPROVED') ORDER BY created_at DESC LIMIT 1) AS open_proposal_id,
      (SELECT json_extract(payload, '$.discount_minor') FROM proposals p WHERE p.case_id=c.id AND p.status IN ('PENDING_APPROVAL','APPROVED') ORDER BY created_at DESC LIMIT 1) AS proposal_amount_minor
    FROM cases c JOIN bank_transactions b ON b.id=c.bank_txn_id LEFT JOIN users u ON u.id=c.assigned_to ORDER BY c.created_at ASC, c.id ASC`).all() as Row[];
  return rows.filter((r) => actor.entityIds.includes(String(r.entity_id))).map((r): Row => ({
    ...r, faults: parseJson(String(r.faults), {}), scenarioTitle: titleOf(r),
  }));
}

export function getCaseDetail(actor: Actor, caseId: string) {
  requirePermission(actor, 'case:read');
  const db = getDb();
  const kase = loadCaseFor(db, actor, caseId);
  const plans = db.prepare('SELECT * FROM case_plans WHERE case_id=? ORDER BY run_no DESC').all(caseId) as Row[];
  const latestRun = (plans[0]?.run_no as number | undefined) ?? 0;
  const bank = db.prepare('SELECT id, amount_minor, currency, value_date, counterparty_name, reference FROM bank_transactions WHERE id=?').get(kase.bank_txn_id);
  const toolCalls = db.prepare('SELECT * FROM tool_calls WHERE case_id=? ORDER BY run_no DESC, seq ASC').all(caseId) as Row[];
  const nodes = db.prepare('SELECT * FROM graph_nodes WHERE case_id=? AND run_no=? ORDER BY rowid').all(caseId, latestRun) as Row[];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (db.prepare('SELECT * FROM graph_edges WHERE case_id=? ORDER BY rowid').all(caseId) as Row[])
    .filter((e) => nodeIds.has(e.from_id) && nodeIds.has(e.to_id));
  const proposals = db.prepare('SELECT * FROM proposals WHERE case_id=? ORDER BY created_at DESC').all(caseId) as Row[];
  const approvals = db.prepare(`SELECT a.*, u.name AS approver_name FROM approvals a LEFT JOIN users u ON u.id=a.approver_id WHERE case_id=? ORDER BY decided_at DESC`).all(caseId);
  const executions = db.prepare('SELECT * FROM executions WHERE case_id=? ORDER BY started_at DESC').all(caseId) as Row[];
  const verifications = db.prepare('SELECT * FROM verifications WHERE case_id=? ORDER BY created_at DESC').all(caseId) as Row[];
  const audit = db.prepare('SELECT * FROM audit_events WHERE case_id=? ORDER BY seq ASC').all(caseId) as Row[];
  const users = Object.fromEntries((db.prepare('SELECT id, name, role FROM users').all() as { id: string; name: string; role: string }[]).map((u) => [u.id, u]));
  const notes = (db.prepare('SELECT * FROM case_notes WHERE case_id=? ORDER BY created_at ASC').all(caseId) as Row[]).map((n): Row => ({ ...n, author_name: users[String(n.author_id)]?.name ?? n.author_id }));

  // What THIS viewer may do on THIS case, with the reason when not. Mirrors the server checks exactly.
  const live = proposals.find((p) => ['PENDING_APPROVAL', 'APPROVED'].includes(String(p.status)));
  const amount = live ? Number(parseJson<Row>(String(live.payload), {}).discount_minor ?? 0) : 0;
  const cur = String(kase.currency ?? 'INR');
  const limit = actor.approvalLimitMinor ?? 0;
  const isProposer = !!live && (live.proposed_by === actor.id || kase.investigated_by === actor.id);
  const ownedByOther = !!kase.assigned_to && kase.assigned_to !== actor.id;
  const awaiting = kase.status === 'AWAITING_APPROVAL' && !!live;
  const why = (ok: boolean, reason: string) => (ok ? null : reason);
  const viewer = {
    role: actor.role, approvalLimitMinor: limit, isAssignee: kase.assigned_to === actor.id, isProposer,
    canInvestigate: can(actor, 'case:investigate') && INVESTIGABLE.includes(kase.status) && !ownedByOther,
    investigateBlockedReason: !can(actor, 'case:investigate') ? 'Only reconciliation analysts investigate' : ownedByOther ? `Assigned to ${users[String(kase.assigned_to)]?.name ?? kase.assigned_to}` : null,
    canClaim: can(actor, 'case:claim') && !kase.assigned_to && ASSIGNABLE.includes(kase.status),
    canAssign: can(actor, 'case:assign') && ASSIGNABLE.includes(kase.status),
    canApprove: can(actor, 'approval:decide') && awaiting && !isProposer && amount <= limit,
    canReject: can(actor, 'approval:decide') && awaiting && !isProposer,
    approveBlockedReason: !awaiting ? null : !can(actor, 'approval:decide') ? 'Only finance controllers approve' : isProposer ? 'You prepared this proposal (separation of duties)'
      : why(amount <= limit, `Adjustment ${formatMinor(amount, cur)} exceeds your approval limit of ${formatMinor(limit, cur)}`),
    canExecute: can(actor, 'execution:trigger') && kase.status === 'APPROVED',
    canAttemptUnapprovedWrite: can(actor, 'execution:trigger') && awaiting,
    canComment: can(actor, 'case:comment'),
    canExportAudit: can(actor, 'audit:export'),
    canUseAi: can(actor, 'ai:assist'),
  };

  return {
    viewer,
    notes,
    case: { ...kase, faults: parseJson(kase.faults, {}), scenarioTitle: titleOf(kase as unknown as Row), investigated_by_name: kase.investigated_by ? users[kase.investigated_by]?.name : null,
      assigned_to_name: kase.assigned_to ? users[kase.assigned_to]?.name ?? kase.assigned_to : null },
    scenario: scenarioOf(kase.scenario) ?? null,
    bank,
    latestRun,
    plans: plans.map((p): Row => ({ ...p, hypotheses: parseJson(String(p.hypotheses), []), rule_results: parseJson(String(p.rule_results), []) })),
    toolCalls: toolCalls.map((t): Row => ({ ...t, args: parseJson(String(t.args), {}), source_refs: parseJson(String(t.source_refs), []) })),
    graph: { nodes: nodes.map((n): Row => ({ ...n, data: parseJson(String(n.data), {}) })), edges },
    proposals: proposals.map((p): Row => ({ ...p, payload: parseJson<Row>(String(p.payload), {}), evidence_manifest: parseJson(String(p.evidence_manifest), []), proposed_by_name: users[String(p.proposed_by)]?.name })),
    approvals,
    executions: executions.map((e): Row => ({ ...e, before_state: parseJson(e.before_state as string, null), after_state: parseJson(e.after_state as string, null) })),
    verifications: verifications.map((v): Row => ({ ...v, checks: parseJson<Row[]>(String(v.checks), []) })),
    audit: audit.map((a): Row => ({ ...a, data: parseJson<Row>(String(a.data), {}) })),
  };
}

export function exportCaseAudit(actor: Actor, caseId: string) {
  requirePermission(actor, 'audit:export');
  const detail = getCaseDetail(actor, caseId);
  return {
    exportedAt: new Date().toISOString(),
    exportedBy: { id: actor.id, name: actor.name, role: actor.role },
    notice: 'Synthetic demo data. Contains observable decisions and actions; no private model reasoning is stored.',
    chainVerification: verifyAuditChain(getDb()),
    ...detail,
  };
}

export function listAudit(actor: Actor, limit = 300) {
  requirePermission(actor, 'audit:read');
  const db = getDb();
  const rows = db.prepare('SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?').all(Math.min(limit, 1000)) as Row[];
  return {
    chain: verifyAuditChain(db),
    events: rows.filter((r) => r.entity_id === null || actor.entityIds.includes(String(r.entity_id))).map((r): Row => ({ ...r, data: parseJson(String(r.data), {}) })),
  };
}

/**
 * Safety metrics are computed by independent SQL over the records — not by trusting workflow counters.
 * "Unauthorized writes" = any successful execution lacking a matching, distinct-identity, hash-bound approval.
 */
export function getMetrics(actor: Actor) {
  requirePermission(actor, 'case:read');
  const db = getDb();
  const scope = actor.entityIds.map(() => '?').join(',');
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS n FROM cases WHERE entity_id IN (${scope}) GROUP BY status`).all(...actor.entityIds) as { status: string; n: number }[];
  const unauthorizedWrites = (db.prepare(`
    SELECT COUNT(*) AS n FROM executions e JOIN proposals p ON p.id=e.proposal_id
    WHERE e.status='SUCCEEDED' AND NOT EXISTS (
      SELECT 1 FROM approvals a WHERE a.id=e.approval_id AND a.proposal_id=p.id AND a.decision='APPROVED'
        AND a.payload_hash=p.payload_hash AND a.evidence_hash=p.evidence_hash AND a.approver_id<>p.proposed_by
        AND a.expires_at > e.started_at)`).get() as { n: number }).n;
  const closedUnverified = (db.prepare(`SELECT COUNT(*) AS n FROM cases c WHERE c.status='CLOSED'
    AND NOT EXISTS (SELECT 1 FROM verifications v WHERE v.case_id=c.id AND v.passed=1)`).get() as { n: number }).n;
  const denied = db.prepare('SELECT reason_code, COUNT(*) AS n FROM denied_actions GROUP BY reason_code ORDER BY n DESC').all() as { reason_code: string; n: number }[];
  const executions = db.prepare(`SELECT status, COUNT(*) AS n FROM executions GROUP BY status`).all() as { status: string; n: number }[];
  const toolCalls = db.prepare(`SELECT decision, COUNT(*) AS n FROM tool_calls GROUP BY decision`).all() as { decision: string; n: number }[];
  const autoMatched = (db.prepare(`SELECT COUNT(*) AS n FROM auto_matches WHERE entity_id IN (${scope})`).get(...actor.entityIds) as { n: number }).n;
  const imports = (db.prepare(`SELECT COUNT(*) AS n FROM ingest_batches WHERE entity_id IN (${scope})`).get(...actor.entityIds) as { n: number }).n;
  return {
    automation: { autoMatched, imports },
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    safety: { unauthorizedWrites, closedUnverified, auditChain: verifyAuditChain(db) },
    denied, executions: Object.fromEntries(executions.map((r) => [r.status, r.n])), toolCalls: Object.fromEntries(toolCalls.map((r) => [r.decision, r.n])),
  };
}
