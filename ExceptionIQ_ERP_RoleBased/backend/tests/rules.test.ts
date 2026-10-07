import { describe, it, expect } from 'vitest';
import { evaluateDiscountPolicy, EvidenceBundle } from '../src/rules/discountPolicy';
import type { SourceRecord } from '../src/tools/sources';

const r = (kind: SourceRecord['kind'], id: string, data: Record<string, unknown>): SourceRecord => ({ kind, id, table: kind, version: 1, hash: 'h', data });
const fp = 'abc123';
function bundle(over: { valueDate?: string; paid?: number; amount?: number; base?: number; bankCurrency?: string; terms?: unknown; clause?: EvidenceBundle['clause']; matches?: SourceRecord[]; status?: string; fp?: string } = {}): EvidenceBundle {
  const amount = over.amount ?? 100_000_00; const paid = over.paid ?? 98_000_00;
  return {
    bank: r('BankTransaction', 'B-1', { amount_minor: paid, currency: over.bankCurrency ?? 'INR', value_date: over.valueDate ?? '2026-09-08', beneficiary_fingerprint: over.fp ?? fp }),
    openItem: r('OpenItem', 'OI-1', { invoice_id: 'INV-1', vendor_id: 'V-1', expected_minor: amount, residual_minor: amount - paid, currency: 'INR', status: over.status ?? 'OPEN' }),
    invoice: r('Invoice', 'INV-1', { vendor_id: 'V-1', po_id: 'PO-1', contract_id: 'C-1', invoice_date: '2026-09-01', amount_minor: amount, discount_base_minor: over.base ?? amount, currency: 'INR' }),
    po: r('PurchaseOrder', 'PO-1', { vendor_id: 'V-1', status: 'APPROVED', currency: 'INR' }),
    vendor: r('Vendor', 'V-1', { verified: 1, beneficiary_fingerprint: fp }),
    contract: r('Contract', 'C-1', { vendor_id: 'V-1', effective_from: '2026-01-01', effective_to: null,
      approved_terms: over.terms === undefined ? { early_payment_discount: { rate_bps: 200, window_days: 10 } } : over.terms }),
    matches: over.matches ?? [],
    clause: over.clause === undefined ? { rate_bps: 200, window_days: 10, sentence: 's', extractor: 't' } : over.clause,
  };
}
const outcome = (b: EvidenceBundle, id: string) => evaluateDiscountPolicy(b).results.find((x) => x.ruleId === id)!.outcome;

describe('AP-DISCOUNT rule pack', () => {
  it('proposes for the canonical case with exact computed values', () => {
    const ev = evaluateDiscountPolicy(bundle());
    expect(ev.outcome).toBe('PROPOSE');
    expect(ev.computed).toEqual({ residualMinor: 2_000_00, discountMinor: 2_000_00, expectedNetMinor: 98_000_00, daysToSettle: 7 });
    expect(ev.results.every((x) => x.outcome === 'PASS')).toBe(true);
  });

  it.each([
    ['2026-09-01', 'PASS'], // day 0
    ['2026-09-11', 'PASS'], // day 10 — inclusive boundary
    ['2026-09-12', 'FAIL'], // day 11
    ['2026-08-31', 'FAIL'], // before invoice date
  ])('discount window boundary: value date %s → %s', (valueDate, expected) => {
    expect(outcome(bundle({ valueDate }), 'R09')).toBe(expected);
  });

  it('fails when the discount is not an exact minor-unit amount (no silent rounding)', () => {
    const b = bundle({ amount: 100_001, base: 100_001, paid: 98_001 });
    expect(outcome(b, 'R10')).toBe('FAIL');
    expect(evaluateDiscountPolicy(b).outcome).toBe('REVIEW');
  });

  it('fails when the paid amount is off by a single paisa', () => {
    expect(outcome(bundle({ paid: 98_000_01 }), 'R10')).toBe('FAIL');
  });

  it('escalates when there is no finance-approved term (missing clause)', () => {
    const b = bundle({ terms: null, clause: null });
    expect(outcome(b, 'R08')).toBe('INSUFFICIENT');
    expect(evaluateDiscountPolicy(b).outcome).toBe('REVIEW');
  });

  it('fails when the extracted clause contradicts the approved term', () => {
    expect(outcome(bundle({ clause: { rate_bps: 250, window_days: 10, sentence: '', extractor: 'x' } }), 'R08')).toBe('FAIL');
  });

  it('blocks on currency conflict', () => {
    const ev = evaluateDiscountPolicy(bundle({ bankCurrency: 'USD' }));
    expect(ev.outcome).toBe('BLOCK');
  });

  it('blocks on beneficiary mismatch', () => {
    expect(evaluateDiscountPolicy(bundle({ fp: 'other' })).outcome).toBe('BLOCK');
  });

  it('blocks on duplicate settlement', () => {
    const m = r('PaymentMatch', 'M-1', { invoice_id: 'INV-1', bank_txn_id: 'B-0' });
    expect(evaluateDiscountPolicy(bundle({ matches: [m] })).outcome).toBe('BLOCK');
    expect(evaluateDiscountPolicy(bundle({ status: 'CLEARED' })).outcome).toBe('BLOCK');
  });

  it('reports INSUFFICIENT rather than guessing when evidence is missing', () => {
    const b = bundle(); delete b.contract;
    const ev = evaluateDiscountPolicy(b);
    expect(ev.outcome).toBe('REVIEW');
    expect(ev.results.find((x) => x.ruleId === 'R01')!.detail).toMatch(/effective contract/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(evaluateDiscountPolicy(bundle()))).toBe(JSON.stringify(evaluateDiscountPolicy(bundle())));
  });
});
