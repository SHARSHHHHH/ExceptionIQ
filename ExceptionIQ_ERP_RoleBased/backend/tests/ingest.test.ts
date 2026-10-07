import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, asha, ravi, dev, nisha, count } from './helpers';
import { importStatement, parseCsv, buildSampleStatement, toMinor, parseStatementText, openLedger } from '../src/ingest/statement';
import { getCaseDetail } from '../src/workflow/queries';
import { decideProposal } from '../src/workflow/approvals';
import { executeProposal } from '../src/workflow/execute';
import { setAiClientForTesting } from '../src/ai/client';
import { getDb } from '../src/db';
import { getMetrics } from '../src/workflow/queries';

const HEADER = 'external_id,value_date,amount,currency,counterparty,reference,beneficiary_account';

describe('bank statement import', () => {
  beforeEach(() => { freshDb(); });
  afterEach(() => setAiClientForTesting(null));

  it('parses amounts exactly and rejects floats-in-disguise', () => {
    expect(toMinor('98,000.50')).toBe(9_800_050);
    expect(toMinor('1.005')).toBeNull();
    expect(toMinor('-5')).toBeNull();
    expect(parseCsv('a,b\n1,2').errors[0]).toMatch(/Missing column/);
  });

  it('auto-matches exact payments, opens classified cases for the rest, and is idempotent', async () => {
    const csv = [HEADER,
      'U1,2026-09-30,125000.00,INR,Shakti Bearings Pvt Ltd,NEFT/SHAKTI/INV2001,50200010100101',     // exact → auto-match
      'U2,2026-09-27,235200.00,INR,Indus Valve Systems,NEFT/INDUS/INV2003,50200010200102',          // 2% in window → proposal
      'U3,2026-09-30,18500.00,INR,Kaveri Office Supplies,NEFT/KAVERI/INV2005,50200010300103',      // fee short → review
      'U4,2026-09-29,72000.00,INR,Bharat Freight Carriers,NEFT/BHARAT/INV2008,99999999999999',      // wrong beneficiary → blocked
      'U5,2026-09-29,500.00,INR,Unknown,MISC,1234',                                                // nothing matches
      'U6,not-a-date,1.00,INR,X,Y,Z',                                                              // rejected
    ].join('\n');
    const r = await importStatement(asha(), 'IN01', parseCsv(csv).rows, { autoInvestigate: true });
    const by = (o: string) => r.outcomes.filter((x) => x.outcome === o);
    expect(by('AUTO_MATCHED')).toHaveLength(1);
    expect(by('REJECTED')).toHaveLength(1);
    expect(by('CASE_CREATED').map((x) => x.exception_type)).toEqual(['SHORT_PAYMENT', 'SHORT_PAYMENT', 'BENEFICIARY_MISMATCH', 'NO_MATCH']);
    const status = Object.fromEntries(by('CASE_CREATED').map((x) => [x.external_id, x.investigation?.status]));
    expect(status).toEqual({ U2: 'AWAITING_APPROVAL', U3: 'NEEDS_REVIEW', U4: 'BLOCKED', U5: 'NEEDS_REVIEW' });
    expect(count(getDb(), "SELECT COUNT(*) AS n FROM ledger_journals")).toBe(0); // auto-match never journals

    const again = await importStatement(asha(), 'IN01', parseCsv(csv).rows);
    expect(again.outcomes.filter((x) => x.outcome === 'DUPLICATE')).toHaveLength(5);
    expect(getMetrics(dev()).automation.autoMatched).toBe(1);

    // The imported discount closes through the normal governed flow.
    const u2 = by('CASE_CREATED').find((x) => x.external_id === 'U2')!;
    const d = getCaseDetail(ravi(), u2.case_id!);
    expect((d.proposals[0] as { payload: { discount_minor: number } }).payload.discount_minor).toBe(4_800_00);
    decideProposal(u2.case_id!, d.proposals[0].id as string, 'APPROVED', 'ok', ravi());
    expect(executeProposal(u2.case_id!, d.proposals[0].id as string, asha()).status).toBe('CLOSED');
  });

  it('enforces role and entity scope on import', async () => {
    const row = { external_id: 'X', value_date: '2026-09-30', amount: '1.00', currency: 'INR', counterparty: 'X', reference: 'X', beneficiary_account: '1' };
    await expect(importStatement(dev(), 'IN01', [row])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(importStatement(nisha(), 'IN01', [row])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(importStatement(asha(), 'SG01', [row])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sample statements are built from the live ledger and keep producing data', async () => {
    for (let round = 0; round < 3; round++) {
      const csv = buildSampleStatement(asha(), 'IN01');
      const r = await importStatement(asha(), 'IN01', parseCsv(csv).rows, { autoInvestigate: true });
      expect(r.outcomes.filter((x) => x.outcome === 'REJECTED')).toHaveLength(0);
      expect(r.outcomes.filter((x) => x.outcome === 'AUTO_MATCHED').length).toBeGreaterThanOrEqual(2);
      expect(r.outcomes.some((x) => x.investigation?.status === 'AWAITING_APPROVAL')).toBe(true);
    }
    expect(openLedger(asha(), 'IN01').length).toBeGreaterThan(0);
  });

  it('free-form text needs the AI parser; its output is validated, not trusted', async () => {
    await expect(parseStatementText(asha(), 'Paid Shakti 1,25,000 on 30 Sep', 'INR')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    setAiClientForTesting({ model: 'fake', structured: async <T>() => ({ rows: [
      { external_id: 'UTR1', value_date: '2026-09-30', amount: '125000.00', currency: 'INR', counterparty: 'Shakti', reference: 'INV2001', beneficiary_account: '50200010100101' },
      { external_id: 'UTR2', value_date: '30/09/2026', amount: '10', currency: 'INR', counterparty: 'Bad', reference: '', beneficiary_account: '' },
    ], warnings: [] }) as T });
    const out = await parseStatementText(asha(), 'Paid Shakti 1,25,000 on 30 Sep', 'INR');
    expect(out.engine).toBe('openai');
    expect(out.invalid).toEqual([{ line: 2, error: expect.stringMatching(/value_date/) }]);
  });
});
