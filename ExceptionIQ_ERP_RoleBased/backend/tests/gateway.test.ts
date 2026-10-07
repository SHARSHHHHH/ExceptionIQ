import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, asha, caseFor, count } from './helpers';
import { ToolGateway } from '../src/tools/gateway';
import { getDb } from '../src/db';
import { SERVICE_ACTORS } from '../src/security/session';
import { getCaseRow } from '../src/workflow/cases';
import { investigateCase } from '../src/workflow/investigate';
import { setPlannerForTesting } from '../src/agent';
import { BASE_HYPOTHESES, Planner, PlannerStep } from '../src/agent/planner';
import { config } from '../src/config';

const gw = () => new ToolGateway(getDb(), getCaseRow(getDb(), caseFor('HAPPY_PATH'))!, 1, SERVICE_ACTORS.agent, asha());

describe('tool gateway', () => {
  beforeEach(() => { freshDb(); });

  it('denies tools outside the allowlist (no SQL, shell or payment tools exist)', () => {
    for (const t of ['db.query', 'shell.exec', 'payment.release', 'vendor.update_bank_details']) {
      expect(gw().call(t, {}, 'x')).toMatchObject({ decision: 'DENIED', reasonCode: 'TOOL_NOT_ALLOWLISTED' });
    }
  });
  it('denies write/compute tools to the agent even though they exist', () => {
    expect(gw().call('resolution.apply_mock_adjustment', { proposal_id: 'P' }, 'x')).toMatchObject({ reasonCode: 'CALLER_NOT_PERMITTED' });
    expect(gw().call('policy.evaluate_resolution', { case_id: 'C' }, 'x')).toMatchObject({ reasonCode: 'CALLER_NOT_PERMITTED' });
  });
  it('validates arguments strictly', () => {
    expect(gw().call('bank.get_transaction', { transaction_id: "B-104' OR 1=1 --" }, 'x')).toMatchObject({ reasonCode: 'INVALID_ARGUMENTS' });
    expect(gw().call('bank.get_transaction', { transaction_id: 'B-104', extra: true }, 'x')).toMatchObject({ reasonCode: 'INVALID_ARGUMENTS' });
  });
  it('enforces case scope: other transactions and unlinked vendors/invoices are refused', () => {
    const g = gw();
    expect(g.call('bank.get_transaction', { transaction_id: 'B-211' }, 'x')).toMatchObject({ reasonCode: 'SCOPE_VIOLATION' });
    expect(g.call('vendor.get_verified_identity', { vendor_id: 'V-17' }, 'x')).toMatchObject({ reasonCode: 'SCOPE_VIOLATION' }); // not yet linked
    expect(g.call('bank.get_transaction', { transaction_id: 'B-104' }, 'x').decision).toBe('ALLOWED');
    expect(g.call('vendor.get_verified_identity', { vendor_id: 'V-17' }, 'x').decision).toBe('ALLOWED'); // now linked
    expect(g.call('vendor.get_verified_identity', { vendor_id: 'V-22' }, 'x')).toMatchObject({ reasonCode: 'SCOPE_VIOLATION' });
    expect(g.call('invoice.get_with_po', { invoice_id: 'INV-311' }, 'x')).toMatchObject({ reasonCode: 'SCOPE_VIOLATION' });
  });
  it('masks vendor bank details', () => {
    const g = gw();
    g.call('bank.get_transaction', { transaction_id: 'B-104' }, 'x');
    const r = g.call('vendor.get_verified_identity', { vendor_id: 'V-17' }, 'x');
    expect(r.decision === 'ALLOWED' && r.records[0].data.beneficiary_ref).toBe('XXXXXXXXXX4821');
  });
  it('enforces the tool-call budget', () => {
    const g = gw();
    for (let i = 0; i < config.budgets.maxToolCalls; i++) expect(g.call('bank.get_transaction', { transaction_id: 'B-104' }, 'x').decision).toBe('ALLOWED');
    expect(g.call('bank.get_transaction', { transaction_id: 'B-104' }, 'x')).toMatchObject({ reasonCode: 'BUDGET_EXHAUSTED' });
  });
  it('logs every decision, allowed or denied, to tool_calls and the audit chain', () => {
    const g = gw();
    g.call('bank.get_transaction', { transaction_id: 'B-104' }, 'x');
    g.call('payment.release', {}, 'x');
    const db = getDb();
    expect(count(db, "SELECT COUNT(*) AS n FROM tool_calls WHERE decision='ALLOWED'")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM tool_calls WHERE decision='DENIED'")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_events WHERE event_type IN ('TOOL_CALL','TOOL_CALL_DENIED')")).toBe(2);
  });
});

/** A hostile planner that tries every trick; the case must end in review with nothing written. */
class HostilePlanner implements Planner {
  name = 'hostile'; model = null; promptVersion = 'test';
  private steps: PlannerStep[] = [
    { kind: 'call', tool: 'resolution.apply_mock_adjustment', args: { proposal_id: 'anything' }, rationale: 'write directly' },
    { kind: 'call', tool: 'bank.get_transaction', args: { transaction_id: 'B-211' }, rationale: 'read another case' },
    { kind: 'call', tool: 'erp.get_open_items', args: { vendor_id: 'V-22', limit: 999 }, rationale: 'bulk read' },
    { kind: 'finish', rationale: 'done' },
  ];
  async hypotheses() { return BASE_HYPOTHESES.map((h) => ({ ...h })); }
  async nextStep() { return this.steps.shift()!; }
  async extractClause() { return null; }
  async draftExplanation() { return 'I approve this myself.'; }
}

describe('hostile planner', () => {
  beforeEach(() => { freshDb(); });
  it('cannot write, cannot cross scope, and the case ends in review', async () => {
    setPlannerForTesting(new HostilePlanner());
    const res = await investigateCase(caseFor('HAPPY_PATH'), asha());
    expect(res.status).toBe('NEEDS_REVIEW');
    const db = getDb();
    expect(count(db, "SELECT COUNT(*) AS n FROM tool_calls WHERE decision='DENIED'")).toBe(3);
    expect(count(db, 'SELECT COUNT(*) AS n FROM proposals')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM executions')).toBe(0);
  });
});
