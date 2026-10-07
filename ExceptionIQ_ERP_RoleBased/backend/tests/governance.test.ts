import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, asha, karan, ravi, dev, lim, caseFor, count } from './helpers';
import { investigateCase } from '../src/workflow/investigate';
import { decideProposal } from '../src/workflow/approvals';
import { executeProposal } from '../src/workflow/execute';
import { getCaseDetail, listCases, getMetrics } from '../src/workflow/queries';
import { simulateSourceChange } from '../src/workflow/admin';
import { getDb } from '../src/db';
import { setClock, resetClock } from '../src/config';

const HAPPY = caseFor('HAPPY_PATH');
async function proposed() {
  const inv = await investigateCase(HAPPY, asha());
  expect(inv.status).toBe('AWAITING_APPROVAL');
  return inv.proposalId!;
}
const ledgerUntouched = () => {
  const db = getDb();
  expect(count(db, 'SELECT COUNT(*) AS n FROM ledger_journals')).toBe(0);
  expect(count(db, "SELECT COUNT(*) AS n FROM payment_matches WHERE bank_txn_id='B-104'")).toBe(0);
  expect(count(db, "SELECT COUNT(*) AS n FROM erp_open_items WHERE id='OI-204' AND residual_minor=200000 AND status='OPEN'")).toBe(1);
};

describe('authority & approval binding', () => {
  beforeEach(() => { freshDb(); resetClock(); });

  it('blocks an unapproved write and leaves the ledger untouched', async () => {
    const pid = await proposed();
    expect(() => executeProposal(HAPPY, pid, asha())).toThrow(expect.objectContaining({ code: 'NOT_APPROVED' }));
    ledgerUntouched();
    expect(getCaseDetail(asha(), HAPPY).case.status).toBe('AWAITING_APPROVAL');
  });

  it('analysts and administrators cannot approve', async () => {
    const pid = await proposed();
    expect(() => decideProposal(HAPPY, pid, 'APPROVED', 'x', karan())).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => decideProposal(HAPPY, pid, 'APPROVED', 'x', dev())).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('enforces separation of duties: the proposer cannot approve', async () => {
    const pid = await proposed();
    getDb().prepare("UPDATE proposals SET proposed_by='U-RAVI' WHERE id=?").run(pid);
    expect(() => decideProposal(HAPPY, pid, 'APPROVED', 'x', ravi())).toThrow(expect.objectContaining({ code: 'SEPARATION_OF_DUTIES' }));
  });

  it('controllers cannot run investigations', async () => {
    await expect(investigateCase(HAPPY, ravi())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejection requires a reason, routes to review, and blocks execution', async () => {
    const pid = await proposed();
    expect(() => decideProposal(HAPPY, pid, 'REJECTED', '', ravi())).toThrow(expect.objectContaining({ code: 'REASON_REQUIRED' }));
    const r = decideProposal(HAPPY, pid, 'REJECTED', 'Discount base excludes freight', ravi());
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(() => executeProposal(HAPPY, pid, asha())).toThrow(expect.objectContaining({ code: 'PROPOSAL_NOT_EXECUTABLE' }));
    ledgerUntouched();
  });

  it('expired approval blocks execution and requires a new decision', async () => {
    const pid = await proposed();
    decideProposal(HAPPY, pid, 'APPROVED', 'ok', ravi());
    setClock(() => new Date(Date.now() + 25 * 3600_000));
    expect(() => executeProposal(HAPPY, pid, asha())).toThrow(expect.objectContaining({ code: 'APPROVAL_EXPIRED' }));
    resetClock();
    ledgerUntouched();
    expect(getCaseDetail(asha(), HAPPY).case.status).toBe('NEEDS_REVIEW');
  });

  it('evidence changing after approval blocks execution', async () => {
    const pid = await proposed();
    decideProposal(HAPPY, pid, 'APPROVED', 'ok', ravi());
    simulateSourceChange(dev(), HAPPY);
    expect(() => executeProposal(HAPPY, pid, asha())).toThrow(expect.objectContaining({ code: 'EVIDENCE_CHANGED' }));
    ledgerUntouched();
    expect(getCaseDetail(asha(), HAPPY).case.status).toBe('NEEDS_REVIEW');
  });

  it('evidence changing before approval prevents the approval itself', async () => {
    const pid = await proposed();
    simulateSourceChange(dev(), HAPPY);
    expect(() => decideProposal(HAPPY, pid, 'APPROVED', 'ok', ravi())).toThrow(expect.objectContaining({ code: 'EVIDENCE_CHANGED' }));
    expect(getCaseDetail(asha(), HAPPY).case.status).toBe('NEEDS_REVIEW');
  });

  it('a payload altered after approval is refused', async () => {
    const pid = await proposed();
    decideProposal(HAPPY, pid, 'APPROVED', 'ok', ravi());
    const db = getDb();
    const p = db.prepare('SELECT payload FROM proposals WHERE id=?').get(pid) as { payload: string };
    db.prepare('UPDATE proposals SET payload=? WHERE id=?').run(p.payload.replace('"discount_minor":200000', '"discount_minor":900000'), pid);
    expect(() => executeProposal(HAPPY, pid, asha())).toThrow(expect.objectContaining({ code: 'PAYLOAD_CHANGED' }));
    ledgerUntouched();
  });

  it('repeated execution is idempotent: exactly one journal and one match', async () => {
    const pid = await proposed();
    decideProposal(HAPPY, pid, 'APPROVED', 'ok', ravi());
    const first = executeProposal(HAPPY, pid, asha());
    const second = executeProposal(HAPPY, pid, ravi());
    expect(first.replayed).toBe(false); expect(second.replayed).toBe(true);
    expect(second.executionId).toBe(first.executionId);
    const db = getDb();
    expect(count(db, 'SELECT COUNT(*) AS n FROM ledger_journals')).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM payment_matches WHERE bank_txn_id='B-104'")).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS n FROM executions')).toBe(1);
  });

  it('write failure rolls back atomically and forbids blind retry', async () => {
    const id = caseFor('WRITE_FAILURE');
    const inv = await investigateCase(id, asha());
    decideProposal(id, inv.proposalId!, 'APPROVED', 'ok', ravi());
    const res = executeProposal(id, inv.proposalId!, asha());
    expect(res.status).toBe('NEEDS_REVIEW');
    const db = getDb();
    expect(count(db, 'SELECT COUNT(*) AS n FROM ledger_journals')).toBe(0); // journal insert rolled back
    expect(count(db, "SELECT COUNT(*) AS n FROM erp_open_items WHERE id='OI-931' AND status='OPEN' AND residual_minor=200000")).toBe(1);
    expect(() => executeProposal(id, inv.proposalId!, asha())).toThrow(expect.objectContaining({ code: 'PREVIOUS_ATTEMPT_FAILED' }));
  });

  it('verification failure never closes the case and gives compensating guidance', async () => {
    const id = caseFor('VERIFY_FAILURE');
    const inv = await investigateCase(id, asha());
    decideProposal(id, inv.proposalId!, 'APPROVED', 'ok', ravi());
    const res = executeProposal(id, inv.proposalId!, asha());
    expect(res.status).toBe('NEEDS_REVIEW');
    const d = getCaseDetail(asha(), id);
    const v = d.verifications[0] as { passed: number; guidance: string; checks: { id: string; passed: boolean }[] };
    expect(v.passed).toBe(0);
    expect(v.checks.find((c) => c.id === 'V1')!.passed).toBe(false);
    expect(v.guidance).toMatch(/Do NOT retry/);
  });

  it('re-investigation supersedes an outstanding proposal', async () => {
    const pid = await proposed();
    decideProposal(HAPPY, pid, 'REJECTED', 'Need fresh look', ravi());
    const again = await investigateCase(HAPPY, asha());
    expect(again.proposalId).not.toBe(pid);
    expect(() => decideProposal(HAPPY, pid, 'APPROVED', 'ok', ravi())).toThrow(expect.objectContaining({ code: 'APPROVAL_GATE_CLOSED' }));
  });
});

describe('entity boundary', () => {
  beforeEach(() => { freshDb(); });
  it('hides SG01 cases from IN01 users (404, not 403)', async () => {
    const sg = caseFor('CROSS_ENTITY');
    expect(listCases(asha()).map((c) => c.id)).not.toContain(sg);
    expect(() => getCaseDetail(asha(), sg)).toThrow(expect.objectContaining({ code: 'NOT_FOUND', httpStatus: 404 }));
    await expect(investigateCase(sg, asha())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(listCases(lim()).map((c) => c.id)).toEqual([sg]);
  });
  it('an IN01 controller cannot approve an SG01 proposal', async () => {
    const sg = caseFor('CROSS_ENTITY');
    const inv = await investigateCase(sg, lim());
    expect(() => decideProposal(sg, inv.proposalId!, 'APPROVED', 'x', ravi())).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('safety metrics', () => {
  beforeEach(() => { freshDb(); });
  it('independently reports zero unauthorized writes and zero unverified closures', async () => {
    const pid = await proposed();
    try { executeProposal(HAPPY, pid, asha()); } catch { /* expected denial */ }
    decideProposal(HAPPY, pid, 'APPROVED', 'ok', ravi());
    executeProposal(HAPPY, pid, asha());
    const m = getMetrics(dev());
    expect(m.safety.unauthorizedWrites).toBe(0);
    expect(m.safety.closedUnverified).toBe(0);
    expect(m.safety.auditChain.valid).toBe(true);
    expect(m.denied.find((d) => d.reason_code === 'NOT_APPROVED')?.n).toBe(1);
  });
  it('detects an unauthorized write inserted behind the workflow', async () => {
    const pid = await proposed();
    getDb().prepare(`INSERT INTO executions VALUES ('EXE-ROGUE', ?, ?, NULL, 'k', 'SUCCEEDED', NULL, NULL, NULL, 'x', '2026-01-01', NULL)`).run(pid, HAPPY);
    expect(getMetrics(dev()).safety.unauthorizedWrites).toBe(1);
  });
});
