import { getDb } from '../db';
import { clock, config } from '../config';
import { Actor, DomainError, Hypothesis } from '../domain/types';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../security/rbac';
import { SERVICE_ACTORS } from '../security/session';
import { redactDeep } from '../security/redaction';
import { screenForInstructions } from '../security/injection';
import { ToolGateway } from '../tools/gateway';
import { TOOLS, AGENT_TOOLS } from '../tools/registry';
import type { SourceRecord } from '../tools/sources';
import { EvidenceGraph } from '../graph/evidence';
import { evaluateDiscountPolicy, policyVersion, EvidenceBundle } from '../rules/discountPolicy';
import { extractDiscountClause, ClauseProposal } from '../rules/clauseExtractor';
import { getPlanner } from '../agent';
import { BASE_HYPOTHESES, EvidenceView, PlannerContext, StepView } from '../agent/planner';
import { ScriptedPlanner } from '../agent/scriptedPlanner';
import { hashOf, newId } from '../util';
import { formatMinor } from '../domain/money';
import { ensureOwnership, loadCaseFor, transition, updateCaseFields } from './cases';

const view = (r: SourceRecord): EvidenceView => ({ kind: r.kind, id: r.id, version: r.version, fields: redactDeep(r.data) });

export function selectOpenItem(bank: SourceRecord | undefined, items: SourceRecord[]): SourceRecord | undefined {
  if (!bank) return items[0];
  const ref = String(bank.data.reference ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return items.find((i) => ref.includes(String(i.data.invoice_id).replace('-', ''))) ?? items[0];
}

export function manifestOf(records: (SourceRecord | undefined)[]) {
  return records.filter(Boolean).map((r) => ({ table: r!.table, id: r!.id, version: r!.version, hash: r!.hash }))
    .sort((a, b) => `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`));
}

/**
 * Runs one bounded, governed investigation (idea doc §6 steps 2–5).
 * The planner chooses read tools adaptively; the gateway enforces boundaries; deterministic rules decide;
 * a proposal is created only when every rule passes, and it always requires controller approval.
 */
export async function investigateCase(caseId: string, actor: Actor) {
  const db = getDb();
  requirePermission(actor, 'case:investigate');
  let kase = loadCaseFor(db, actor, caseId);
  if (!['OPEN', 'NEEDS_REVIEW', 'BLOCKED'].includes(kase.status)) {
    throw new DomainError('INVALID_STATE', `Investigation cannot start while case is ${kase.status}`, 409);
  }
  kase = ensureOwnership(db, kase, actor);
  db.prepare("UPDATE proposals SET status='SUPERSEDED' WHERE case_id=? AND status IN ('PENDING_APPROVAL','APPROVED')").run(caseId);
  kase = transition(db, kase, 'INVESTIGATING', actor, 'Investigation started');

  const runNo = ((db.prepare('SELECT MAX(run_no) AS r FROM case_plans WHERE case_id=?').get(caseId) as { r: number | null }).r ?? 0) + 1;
  const planner = getPlanner();
  const agent = SERVICE_ACTORS.agent;
  const gateway = new ToolGateway(db, kase, runNo, agent, actor);
  const graph = new EvidenceGraph(db, caseId, runNo);
  const caseNode = graph.node('Case', `Case ${caseId}`, { refId: caseId, data: { title: kase.title } });
  const started = Date.now();
  const history: StepView[] = [];
  const allowedTools = AGENT_TOOLS.map((n) => ({ name: n, description: TOOLS[n].description, boundary: TOOLS[n].boundary }));
  const ctx = (): PlannerContext => ({ caseId, bankTxnId: kase.bank_txn_id, evidence: [...gateway.evidence.values()].map(view), history, allowedTools,
    remainingCalls: config.budgets.maxToolCalls - gateway.callsUsed });

  let plannerErrors = 0;
  let stopReason: string | null = null;
  const notePlannerError = (e: unknown, phase: string) => {
    plannerErrors++;
    appendAudit(db, { caseId, entityId: kase.entity_id, actor: agent, type: 'PLANNER_ERROR', summary: `Planner error during ${phase}`, data: { error: (e as Error).message, plannerErrors } });
  };

  let hypotheses: Hypothesis[];
  try { hypotheses = await planner.hypotheses(ctx()); } catch (e) { notePlannerError(e, 'planning'); hypotheses = BASE_HYPOTHESES.map((h) => ({ ...h })); }
  const planId = newId('PLAN');
  db.prepare('INSERT INTO case_plans (id, case_id, run_no, planner, model, prompt_version, hypotheses, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(planId, caseId, runNo, planner.name, planner.model, planner.promptVersion, JSON.stringify(hypotheses), clock.now().toISOString());
  appendAudit(db, { caseId, entityId: kase.entity_id, actor: agent, type: 'PLAN_CREATED', correlationId: planId,
    summary: `Run ${runNo}: ${hypotheses.length} hypotheses (${planner.name}${planner.model ? ` / ${planner.model}` : ''})`,
    data: { runNo, planner: planner.name, model: planner.model, promptVersion: planner.promptVersion, hypotheses: hypotheses.map((h) => h.code), initiatedBy: actor.id } });

  // ---- Adaptive, bounded investigation loop ----
  const maxIterations = config.budgets.maxToolCalls + 5;
  for (let i = 0; i < maxIterations; i++) {
    if (Date.now() - started > config.budgets.maxInvestigationMs) { stopReason = 'Time budget exhausted'; break; }
    let step;
    try { step = await planner.nextStep(ctx()); } catch (e) {
      notePlannerError(e, 'step');
      if (plannerErrors > config.budgets.maxPlannerErrors) { stopReason = 'Planner failed repeatedly; retry budget exhausted'; break; }
      continue;
    }
    if (step.kind === 'finish') break;
    const r = gateway.call(step.tool, step.args, step.rationale, 'agent');
    history.push({ tool: step.tool, args: step.args, decision: r.decision, summary: r.decision === 'ALLOWED' ? r.summary : `${r.reasonCode}: ${r.reason}` });
    if (r.decision === 'ALLOWED') for (const rec of r.records) graph.source(rec, r.toolCallId);
    else if (r.reasonCode === 'BUDGET_EXHAUSTED') { stopReason = 'Tool-call budget exhausted'; break; }
  }
  if (history.length === 0 && !stopReason) stopReason = 'Planner finished without retrieving any evidence';

  // ---- Assemble the evidence bundle from gateway-retrieved records only ----
  const ev = [...gateway.evidence.values()];
  const bank = ev.find((r) => r.kind === 'BankTransaction');
  const openItem = selectOpenItem(bank, ev.filter((r) => r.kind === 'OpenItem'));
  const invoice = ev.find((r) => r.kind === 'Invoice' && r.id === openItem?.data.invoice_id);
  const po = ev.find((r) => r.kind === 'PurchaseOrder' && r.id === invoice?.data.po_id);
  const vendor = ev.find((r) => r.kind === 'Vendor' && r.id === (invoice?.data.vendor_id ?? bank?.data.vendor_hint));
  const contract = ev.find((r) => r.kind === 'Contract');
  const matches = ev.filter((r) => r.kind === 'PaymentMatch');
  const nodeOf = (r?: SourceRecord) => (r ? graph.sourceNodeFor(r.table, r.id) : undefined);
  const bankNode = nodeOf(bank);
  if (bankNode) graph.edge(bankNode, caseNode, 'derived_from');

  // ---- Clause proposal (text extraction proposes; rules decide) ----
  let clause: ClauseProposal | null = null;
  let clauseNode: string | undefined;
  let extractorConflict: string | null = null;
  const contractNode = nodeOf(contract);
  if (contract) {
    const text = String(contract.data.clause_text ?? '');
    const deterministic = extractDiscountClause(text);
    clause = deterministic;
    if (!(planner instanceof ScriptedPlanner)) {
      try {
        const modelClause = await planner.extractClause(text);
        if (modelClause && deterministic && (modelClause.rate_bps !== deterministic.rate_bps || modelClause.window_days !== deterministic.window_days)) {
          extractorConflict = `Model clause (${modelClause.rate_bps}bps/${modelClause.window_days}d) disagrees with deterministic extractor (${deterministic.rate_bps}bps/${deterministic.window_days}d)`;
        } else if (modelClause && !deterministic) {
          extractorConflict = 'Model proposed a clause the deterministic extractor could not confirm';
        }
        clause = modelClause ?? deterministic;
      } catch (e) { notePlannerError(e, 'clause extraction'); }
    }
    if (clause && contractNode) {
      clauseNode = graph.node('Clause', `${clause.rate_bps / 100}% within ${clause.window_days} days`, { refId: contract.id, data: { ...clause } });
      graph.edge(contractNode, clauseNode, 'derived_from');
    }
    if (extractorConflict && contractNode) graph.finding('Clause extraction conflict', 'FLAGGED', [contractNode], { detail: extractorConflict });

    // Injection screening: a visible flag, never a permission change.
    const signals = screenForInstructions(text);
    if (signals.length && contractNode) {
      graph.finding(`Untrusted instruction detected in ${contract.id} — treated as data, not authority`, 'FLAGGED', [contractNode], { signals });
      appendAudit(db, { caseId, entityId: kase.entity_id, actor: agent, type: 'INJECTION_FLAGGED', summary: `${signals.length} instruction pattern(s) in ${contract.id}`,
        data: { contract: contract.id, patterns: signals.map((s) => s.patternId) } });
    }
  }

  // ---- Deterministic evaluation ----
  const bundle: EvidenceBundle = { bank, openItem, invoice, po, vendor, contract, matches, clause };
  const evaluation = evaluateDiscountPolicy(bundle);
  const policyCallId = newId('TC');
  db.prepare(`INSERT INTO tool_calls (id, case_id, run_no, seq, tool, actor, args, rationale, decision, result_summary, source_refs, duration_ms, created_at)
    VALUES (?,?,?,?,?,?,?,?,'ALLOWED',?,?,0,?)`).run(policyCallId, caseId, runNo, history.length + 1, 'policy.evaluate_resolution', 'svc-rules',
    JSON.stringify({ case_id: caseId }), `Deterministic rule pack ${policyVersion()}`, `Outcome ${evaluation.outcome}; ${evaluation.results.filter((r) => r.outcome === 'PASS').length}/${evaluation.results.length} rules passed`,
    JSON.stringify(manifestOf([bank, openItem, invoice, po, vendor, contract])), clock.now().toISOString());

  const ruleNodes: string[] = [];
  const idToNode = new Map(ev.map((r) => [r.id, nodeOf(r)!]));
  for (const rr of evaluation.results) {
    const n = graph.node('RuleResult', `${rr.ruleId} ${rr.name}`, { status: rr.outcome, refId: rr.ruleId, data: { ...rr } });
    for (const sid of rr.sources) { const src = idToNode.get(sid); if (src) graph.edge(src, n, 'evaluated_by'); }
    if (rr.ruleId === 'R08' && clauseNode) graph.edge(clauseNode, n, 'evaluated_by');
    ruleNodes.push(n);
  }

  // Findings: each must be source-linked (graph enforces it).
  const { residualMinor, discountMinor, daysToSettle } = evaluation.computed;
  if (residualMinor !== null) {
    graph.finding(`Residual ${formatMinor(residualMinor, String(bank?.data.currency ?? kase.currency))} between ${bank?.id} and ${invoice?.id ?? openItem?.data.invoice_id}`, 'SUPPORTED',
      [nodeOf(bank), nodeOf(openItem)].filter(Boolean) as string[], { residualMinor });
  }
  for (const rr of evaluation.results.filter((r) => r.outcome === 'BLOCK' || r.outcome === 'FAIL')) {
    graph.finding(`${rr.name}: ${rr.detail}`, 'CONTRADICTED', rr.sources.map((s) => idToNode.get(s)).filter(Boolean) as string[], { ruleId: rr.ruleId });
  }

  let outcome = evaluation.outcome;
  const reasons = [...evaluation.reasons];
  if (stopReason) { outcome = 'REVIEW'; reasons.unshift(`Investigation stopped: ${stopReason}`); }
  if (extractorConflict && outcome === 'PROPOSE') { outcome = 'REVIEW'; reasons.unshift(extractorConflict); }

  // Hypothesis status from deterministic results only.
  const r = Object.fromEntries(evaluation.results.map((x) => [x.ruleId, x.outcome]));
  const discountOk = r.R08 === 'PASS' && r.R09 === 'PASS' && r.R10 === 'PASS';
  for (const h of hypotheses) {
    if (h.code === 'EARLY_PAYMENT_DISCOUNT') { h.status = discountOk ? 'SUPPORTED' : (r.R08 === 'INSUFFICIENT' || r.R09 === 'FAIL') ? 'REJECTED' : 'INCONCLUSIVE'; h.note = discountOk ? `Settled on day ${daysToSettle}; discount of ${formatMinor(discountMinor!, String(invoice?.data.currency))} equals the residual` : evaluation.results.find((x) => ['R08', 'R09', 'R10'].includes(x.ruleId) && x.outcome !== 'PASS')?.detail; }
    if (h.code === 'DUPLICATE_SETTLEMENT') { h.status = r.R05 === 'BLOCK' ? 'SUPPORTED' : r.R05 === 'PASS' ? 'REJECTED' : 'INCONCLUSIVE'; }
    if (h.code === 'WRONG_REFERENCE') { h.status = r.R03 === 'BLOCK' ? 'SUPPORTED' : r.R03 === 'PASS' && r.R04 === 'PASS' ? 'REJECTED' : 'INCONCLUSIVE'; }
    if (h.code === 'BANK_FEE' || h.code === 'PARTIAL_PAYMENT') { h.status = discountOk ? 'REJECTED' : 'INCONCLUSIVE'; h.note = discountOk ? 'Residual fully explained by discount' : 'Not testable with available sources'; }
  }

  let explanation: string;
  try {
    explanation = await planner.draftExplanation({ caseId, outcome, reasons, computed: evaluation.computed, evidence: ev.map(view) });
  } catch (e) {
    notePlannerError(e, 'explanation');
    explanation = await new ScriptedPlanner().draftExplanation({ caseId, outcome, reasons, computed: evaluation.computed, evidence: [] });
  }

  const rootCause = outcome === 'PROPOSE' ? 'Eligible early-payment discount omitted from ERP reconciliation treatment'
    : outcome === 'BLOCK' ? `Blocked by policy: ${evaluation.results.filter((x) => x.outcome === 'BLOCK').map((x) => x.name).join(', ')}`
      : 'Unexplained or unsupported difference — analyst review required';
  kase = updateCaseFields(db, kase, {
    residual_minor: residualMinor, root_cause: rootCause, explanation, investigated_by: actor.id,
    risk_class: outcome === 'PROPOSE' ? 'ACCOUNTING_ADJUSTMENT' : outcome === 'BLOCK' ? 'CONTROL_BREACH_RISK' : 'UNRESOLVED',
  });
  appendAudit(db, { caseId, entityId: kase.entity_id, actor: SERVICE_ACTORS.agent, type: 'RULES_EVALUATED', correlationId: policyCallId,
    summary: `${policyVersion()} → ${evaluation.outcome}`, data: { policyVersion: policyVersion(), results: evaluation.results.map((x) => ({ id: x.ruleId, outcome: x.outcome })), computed: evaluation.computed } });

  let proposalId: string | null = null;
  if (outcome === 'PROPOSE' && bank && openItem && invoice && discountMinor !== null) {
    const manifest = manifestOf([bank, openItem, invoice, po, vendor, contract]);
    const payload = {
      action: 'POST_DISCOUNT_ADJUSTMENT_AND_MATCH',
      entity_id: kase.entity_id, currency: String(invoice.data.currency),
      bank_txn_id: bank.id, invoice_id: invoice.id, open_item_id: openItem.id,
      discount_minor: discountMinor, match_amount_minor: Number(bank.data.amount_minor), expected_residual_after_minor: 0,
      journal: {
        memo: `Early-payment discount ${invoice.id} per ${contract?.id} (${clause?.rate_bps}bps within ${clause?.window_days}d)`,
        lines: [
          { account: '2100', name: 'Accounts Payable', debit_minor: discountMinor, credit_minor: 0 },
          { account: '4910', name: 'Purchase Discounts Received', debit_minor: 0, credit_minor: discountMinor },
        ],
      },
      before: { open_item_residual_minor: Number(openItem.data.residual_minor), open_item_status: String(openItem.data.status) },
    };
    proposalId = newId('PRP');
    db.prepare(`INSERT INTO proposals VALUES (?,?,?,?,?,?,?,?,?,?,'PENDING_APPROVAL',?,?)`).run(proposalId, caseId, runNo, payload.action, JSON.stringify(payload),
      hashOf(payload), JSON.stringify(manifest), hashOf(manifest), policyVersion(), 'ACCOUNTING_ADJUSTMENT', actor.id, clock.now().toISOString());
    const pNode = graph.node('Proposal', `Post discount ${formatMinor(discountMinor, String(invoice.data.currency))}`, { refId: proposalId, status: 'PENDING_APPROVAL', data: { payloadHash: hashOf(payload) } });
    for (const n of ruleNodes) graph.edge(n, pNode, 'supports');
    graph.edge(caseNode, pNode, 'proposes');
    appendAudit(db, { caseId, entityId: kase.entity_id, actor, type: 'PROPOSAL_CREATED', correlationId: proposalId,
      summary: `Proposal ${proposalId}: ${payload.action} (${discountMinor} minor units), controller approval required`,
      data: { proposalId, payloadHash: hashOf(payload), evidenceHash: hashOf(manifest), policyVersion: policyVersion(), riskClass: 'ACCOUNTING_ADJUSTMENT' } });
    kase = transition(db, kase, 'AWAITING_APPROVAL', SERVICE_ACTORS.agent, 'All rules passed; accounting adjustment requires controller approval');
  } else if (outcome === 'BLOCK') {
    kase = transition(db, kase, 'BLOCKED', SERVICE_ACTORS.agent, reasons.filter((x) => /^R0[235]/.test(x)).join(' | ') || reasons[0]);
  } else {
    kase = transition(db, kase, 'NEEDS_REVIEW', SERVICE_ACTORS.agent, reasons.slice(0, 3).join(' | ') || 'Analyst review required');
  }

  db.prepare('UPDATE case_plans SET hypotheses=?, rule_results=?, outcome=?, finished_at=? WHERE id=?')
    .run(JSON.stringify(hypotheses), JSON.stringify(evaluation.results), outcome, clock.now().toISOString(), planId);
  return { caseId, runNo, outcome, status: kase.status, proposalId, toolCalls: history.length, durationMs: Date.now() - started };
}
