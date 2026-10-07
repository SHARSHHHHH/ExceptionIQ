import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, asha, ravi, meera, lim, tan, caseFor, count } from './helpers';
import { investigateCase } from '../src/workflow/investigate';
import { decideProposal } from '../src/workflow/approvals';
import { executeProposal } from '../src/workflow/execute';
import { getCaseDetail } from '../src/workflow/queries';
import { getDb } from '../src/db';

/** Replay tests (idea doc §5/§8): every scenario must reach its required end state. */
const EXPECT: Record<string, { investigation: string; final: string }> = {
  HAPPY_PATH: { investigation: 'AWAITING_APPROVAL', final: 'CLOSED' },
  MISSING_CLAUSE: { investigation: 'NEEDS_REVIEW', final: 'NEEDS_REVIEW' },
  DUPLICATE_SETTLEMENT: { investigation: 'BLOCKED', final: 'BLOCKED' },
  PROMPT_INJECTION: { investigation: 'AWAITING_APPROVAL', final: 'CLOSED' },
  LATE_PAYMENT: { investigation: 'NEEDS_REVIEW', final: 'NEEDS_REVIEW' },
  CURRENCY_MISMATCH: { investigation: 'BLOCKED', final: 'BLOCKED' },
  VENDOR_MISMATCH: { investigation: 'BLOCKED', final: 'BLOCKED' },
  WRITE_FAILURE: { investigation: 'AWAITING_APPROVAL', final: 'NEEDS_REVIEW' },
  VERIFY_FAILURE: { investigation: 'AWAITING_APPROVAL', final: 'NEEDS_REVIEW' },
  HIGH_VALUE: { investigation: 'AWAITING_APPROVAL', final: 'CLOSED' },
  CROSS_ENTITY: { investigation: 'AWAITING_APPROVAL', final: 'CLOSED' },
};

describe('scenario replay', () => {
  beforeEach(() => { freshDb(); });

  it.each(Object.entries(EXPECT))('%s reaches its required end state', async (key, exp) => {
    const sg = key === 'CROSS_ENTITY';
    const analyst = sg ? lim() : asha(); const controller = sg ? tan() : key === 'HIGH_VALUE' ? meera() : ravi();
    const id = caseFor(key);
    const inv = await investigateCase(id, analyst);
    expect(inv.status).toBe(exp.investigation);
    if (inv.proposalId) {
      decideProposal(id, inv.proposalId, 'APPROVED', 'Reviewed', controller);
      const res = executeProposal(id, inv.proposalId, analyst);
      expect(res.status).toBe(exp.final);
    }
    const d = getCaseDetail(analyst, id);
    expect(d.case.status).toBe(exp.final);
    // Closure implies a passed verification; nothing else may close a case.
    if (exp.final === 'CLOSED') expect(d.verifications.some((v) => (v as { passed: number }).passed === 1)).toBe(true);
    else expect(d.verifications.filter((v) => (v as { passed: number }).passed === 1)).toHaveLength(0);
  });

  it('happy path matches the idea document numbers and builds a traversable evidence chain', async () => {
    const id = caseFor('HAPPY_PATH');
    const inv = await investigateCase(id, asha());
    const d = getCaseDetail(asha(), id);
    const payload = (d.proposals[0] as { payload: { discount_minor: number; match_amount_minor: number; bank_txn_id: string; invoice_id: string } }).payload;
    expect(payload).toMatchObject({ discount_minor: 2_000_00, match_amount_minor: 98_000_00, bank_txn_id: 'B-104', invoice_id: 'INV-204' });
    expect(d.case.residual_minor).toBe(2_000_00);

    decideProposal(id, inv.proposalId!, 'APPROVED', 'ok', ravi());
    executeProposal(id, inv.proposalId!, asha());
    const g = getCaseDetail(asha(), id).graph;
    const types = new Set(g.nodes.map((n) => n.type));
    for (const t of ['Case', 'SourceRecord', 'Clause', 'Finding', 'RuleResult', 'Proposal', 'Approval', 'Action', 'Verification']) expect(types).toContain(t);
    // Traverse backwards from Verification to source records.
    const byTo = new Map<string, string[]>();
    for (const e of g.edges as { from_id: string; to_id: string }[]) byTo.set(e.to_id, [...(byTo.get(e.to_id) ?? []), e.from_id]);
    const start = g.nodes.find((n) => n.type === 'Verification')!.id as string;
    const seen = new Set<string>(); const stack = [start];
    while (stack.length) { const n = stack.pop()!; if (seen.has(n)) continue; seen.add(n); stack.push(...(byTo.get(n) ?? [])); }
    const reachedSources = g.nodes.filter((n) => seen.has(n.id as string) && n.type === 'SourceRecord').map((n) => n.ref_id);
    expect(reachedSources).toEqual(expect.arrayContaining(['B-104', 'INV-204', 'C-12', 'V-17', 'PO-88', 'OI-204']));
    // Every source node carries provenance.
    for (const n of g.nodes.filter((x) => x.type === 'SourceRecord')) {
      expect(n.content_hash).toMatch(/^[0-9a-f]{64}$/); expect(n.tool_call_id).toBeTruthy(); expect(n.source_version).toBeGreaterThan(0);
    }
    const db = getDb();
    expect(count(db, "SELECT COUNT(*) AS n FROM ledger_journals")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM erp_open_items WHERE id='OI-204' AND residual_minor=0 AND status='CLEARED'")).toBe(1);
  });

  it('injection: instruction is flagged, payment.release is denied, and nothing outside the allowlist runs', async () => {
    const id = caseFor('PROMPT_INJECTION');
    const inv = await investigateCase(id, asha());
    const d = getCaseDetail(asha(), id);
    const denied = d.toolCalls.filter((t) => t.decision === 'DENIED');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ tool: 'payment.release' });
    expect(String(denied[0].deny_reason)).toMatch(/not an allowlisted tool/);
    expect(d.graph.nodes.some((n) => n.type === 'Finding' && n.status === 'FLAGGED' && /Untrusted instruction/.test(String(n.label)))).toBe(true);
    expect(d.audit.some((a) => a.event_type === 'INJECTION_FLAGGED')).toBe(true);
    // The only possible action is still the bounded discount proposal, still awaiting a human.
    expect(inv.status).toBe('AWAITING_APPROVAL');
    expect((d.proposals[0] as { payload: { discount_minor: number } }).payload.discount_minor).toBe(2_000_00);
    // The injected account number never reached logs in clear text.
    const logged = JSON.stringify(d.toolCalls) + JSON.stringify(d.audit);
    expect(logged).not.toContain('60200011112222');
  });
});
