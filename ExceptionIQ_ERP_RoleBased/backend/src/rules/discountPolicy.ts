import { RuleResult } from '../domain/types';
import { calendarDaysBetween, isWithin } from '../domain/dates';
import { percentOfExact } from '../domain/money';
import type { SourceRecord } from '../tools/sources';
import type { ClauseProposal } from './clauseExtractor';

export const POLICY_PACK = { id: 'AP-DISCOUNT', version: '1.2.0', name: 'Early-payment discount reconciliation' };
export const policyVersion = () => `${POLICY_PACK.id}@${POLICY_PACK.version}`;

export interface EvidenceBundle {
  bank?: SourceRecord;
  openItem?: SourceRecord;
  invoice?: SourceRecord;
  po?: SourceRecord;
  vendor?: SourceRecord;
  contract?: SourceRecord;
  matches: SourceRecord[];
  clause: ClauseProposal | null;
}

export interface PolicyEvaluation {
  outcome: 'PROPOSE' | 'BLOCK' | 'REVIEW';
  results: RuleResult[];
  computed: { residualMinor: number | null; discountMinor: number | null; expectedNetMinor: number | null; daysToSettle: number | null };
  reasons: string[];
}

/** Rule catalogue, exposed read-only to the UI. Changing a rule is a reviewed code change with tests. */
export const RULE_CATALOGUE = [
  { id: 'R01', name: 'Evidence complete', version: '1.0.0', onFail: 'REVIEW', description: 'Bank, ERP open item, invoice, PO and vendor are retrieved; contract too when a residual exists.' },
  { id: 'R02', name: 'Currency consistent', version: '1.0.0', onFail: 'BLOCK', description: 'Bank, invoice and open item share one currency. No FX inference in the MVP.' },
  { id: 'R03', name: 'Vendor identity verified', version: '1.1.0', onFail: 'BLOCK', description: 'Vendor is verified and the bank beneficiary fingerprint equals the verified vendor fingerprint.' },
  { id: 'R04', name: 'Invoice ↔ PO linkage', version: '1.0.0', onFail: 'REVIEW', description: 'Invoice references an approved PO of the same vendor and currency.' },
  { id: 'R05', name: 'No duplicate settlement', version: '1.0.0', onFail: 'BLOCK', description: 'Open item is OPEN and neither the invoice nor the bank transaction is already matched.' },
  { id: 'R06', name: 'Residual consistent', version: '1.0.0', onFail: 'REVIEW', description: 'ERP residual equals invoice amount minus bank amount, exactly.' },
  { id: 'R07', name: 'Contract effective', version: '1.0.0', onFail: 'REVIEW', description: 'The invoice\'s contract belongs to the vendor and is effective on the invoice date.' },
  { id: 'R08', name: 'Approved term matches clause', version: '1.1.0', onFail: 'REVIEW', description: 'A finance-approved discount term exists and the extracted clause matches it exactly. Missing or ambiguous terms escalate.' },
  { id: 'R09', name: 'Settled within discount window', version: '1.0.0', onFail: 'REVIEW', description: 'Calendar days from invoice date to bank value date are within the approved window (inclusive).' },
  { id: 'R10', name: 'Discount amount exact', version: '1.0.0', onFail: 'REVIEW', description: 'base × rate is an exact minor-unit amount and invoice − discount equals the bank amount.' },
] as const;

const meta = (id: string) => RULE_CATALOGUE.find((r) => r.id === id)!;
const n = (v: unknown) => Number(v);
const s = (v: unknown) => String(v);

/** Pure, deterministic evaluation. Same inputs → same outputs; no I/O, no model calls. */
export function evaluateDiscountPolicy(ev: EvidenceBundle): PolicyEvaluation {
  const results: RuleResult[] = [];
  const add = (id: string, outcome: RuleResult['outcome'], detail: string, sources: (SourceRecord | undefined)[], facts: Record<string, unknown> = {}) => {
    const m = meta(id);
    results.push({ ruleId: id, name: m.name, version: m.version, outcome, detail, sources: sources.filter(Boolean).map((r) => r!.id), facts });
  };
  const fail = (id: string) => (meta(id).onFail === 'BLOCK' ? 'BLOCK' : 'FAIL') as RuleResult['outcome'];
  const { bank, openItem, invoice, po, vendor, contract } = ev;

  const residual = bank && openItem ? n(openItem.data.expected_minor) - n(bank.data.amount_minor) : null;

  // R01
  const missing = [!bank && 'bank transaction', !openItem && 'ERP open item', !invoice && 'invoice', !po && 'purchase order', !vendor && 'vendor identity',
    residual !== 0 && !contract && 'effective contract'].filter(Boolean) as string[];
  add('R01', missing.length ? 'INSUFFICIENT' : 'PASS', missing.length ? `Missing: ${missing.join(', ')}` : 'All required records retrieved', [bank, openItem, invoice, po, vendor, contract], { missing });

  // R02
  if (bank && invoice && openItem) {
    const cur = [s(bank.data.currency), s(invoice.data.currency), s(openItem.data.currency)];
    const ok = new Set(cur).size === 1;
    add('R02', ok ? 'PASS' : fail('R02'), ok ? `All amounts in ${cur[0]}` : `Currency conflict: bank ${cur[0]}, invoice ${cur[1]}, ERP ${cur[2]}`, [bank, invoice, openItem], { currencies: cur });
  } else add('R02', 'INSUFFICIENT', 'Cannot compare currencies without bank, invoice and open item', [bank, invoice, openItem]);

  // R03
  if (bank && vendor && invoice && openItem) {
    const checks = {
      vendorVerified: n(vendor.data.verified) === 1,
      beneficiaryMatches: s(bank.data.beneficiary_fingerprint) === s(vendor.data.beneficiary_fingerprint),
      invoiceVendorMatches: s(invoice.data.vendor_id) === vendor.id,
      openItemVendorMatches: s(openItem.data.vendor_id) === vendor.id,
    };
    const ok = Object.values(checks).every(Boolean);
    add('R03', ok ? 'PASS' : fail('R03'), ok ? `Beneficiary of ${bank.id} matches verified vendor ${vendor.id}` :
      `Identity check failed: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}`, [bank, vendor, invoice, openItem], checks);
  } else add('R03', 'INSUFFICIENT', 'Vendor identity cannot be confirmed with missing records', [bank, vendor, invoice]);

  // R04
  if (invoice && po) {
    const checks = { poReferenced: s(invoice.data.po_id) === po.id, sameVendor: s(po.data.vendor_id) === s(invoice.data.vendor_id),
      poApproved: s(po.data.status) === 'APPROVED', sameCurrency: s(po.data.currency) === s(invoice.data.currency) };
    const ok = Object.values(checks).every(Boolean);
    add('R04', ok ? 'PASS' : fail('R04'), ok ? `${invoice.id} is linked to approved ${po.id}` : `Linkage failed: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}`, [invoice, po], checks);
  } else add('R04', 'INSUFFICIENT', 'Invoice or PO not retrieved', [invoice, po]);

  // R05
  if (bank && openItem && invoice) {
    const invMatches = ev.matches.filter((m) => s(m.data.invoice_id) === invoice.id);
    const bankMatches = ev.matches.filter((m) => s(m.data.bank_txn_id) === bank.id);
    const ok = s(openItem.data.status) === 'OPEN' && invMatches.length === 0 && bankMatches.length === 0;
    add('R05', ok ? 'PASS' : fail('R05'), ok ? `No prior settlement of ${invoice.id}; ${bank.id} unmatched` :
      `Duplicate settlement risk: open item ${s(openItem.data.status)}; existing matches ${invMatches.map((m) => `${s(m.data.bank_txn_id)}→${s(m.data.invoice_id)}`).join(', ') || 'none'}`,
      [bank, openItem, invoice, ...invMatches], { openItemStatus: openItem.data.status, existingMatches: invMatches.map((m) => m.id) });
  } else add('R05', 'INSUFFICIENT', 'Settlement history unavailable', [bank, openItem]);

  // R06
  if (bank && openItem && invoice) {
    const ok = n(openItem.data.expected_minor) === n(invoice.data.amount_minor) && n(openItem.data.residual_minor) === residual;
    add('R06', ok ? 'PASS' : fail('R06'), ok ? `Residual ${residual} minor units = ${n(invoice.data.amount_minor)} − ${n(bank.data.amount_minor)}` :
      `ERP residual ${n(openItem.data.residual_minor)} does not equal observed difference ${residual}`, [bank, openItem, invoice],
      { invoiceMinor: n(invoice.data.amount_minor), bankMinor: n(bank.data.amount_minor), erpResidualMinor: n(openItem.data.residual_minor), observedResidualMinor: residual });
  } else add('R06', 'INSUFFICIENT', 'Cannot compute residual', [bank, openItem, invoice]);

  // R07
  if (invoice && contract) {
    const checks = {
      invoiceReferencesContract: s(invoice.data.contract_id) === contract.id,
      sameVendor: s(contract.data.vendor_id) === s(invoice.data.vendor_id),
      effectiveOnInvoiceDate: isWithin(s(invoice.data.invoice_date), s(contract.data.effective_from), contract.data.effective_to ? s(contract.data.effective_to) : null),
    };
    const ok = Object.values(checks).every(Boolean);
    add('R07', ok ? 'PASS' : fail('R07'), ok ? `${contract.id} effective on ${s(invoice.data.invoice_date)}` : `Contract check failed: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}`, [invoice, contract], checks);
  } else add('R07', 'INSUFFICIENT', 'No effective contract retrieved', [invoice, contract]);

  // R08
  const approved = (contract?.data.approved_terms as { early_payment_discount?: { rate_bps: number; window_days: number } } | null)?.early_payment_discount ?? null;
  if (!contract) add('R08', 'INSUFFICIENT', 'No contract to evaluate', []);
  else if (!approved) add('R08', 'INSUFFICIENT', `${contract.id} has no finance-approved early-payment term; entitlement is not inferred`, [contract], { clauseProposal: ev.clause });
  else if (!ev.clause) add('R08', 'FAIL', `Approved term exists but no matching clause was found in the text of ${contract.id}`, [contract], { approved });
  else {
    const ok = ev.clause.rate_bps === approved.rate_bps && ev.clause.window_days === approved.window_days;
    add('R08', ok ? 'PASS' : 'FAIL', ok ? `Clause "${ev.clause.rate_bps / 100}% within ${ev.clause.window_days} days" matches approved term` :
      `Extracted clause (${ev.clause.rate_bps}bps/${ev.clause.window_days}d) contradicts approved term (${approved.rate_bps}bps/${approved.window_days}d)`,
      [contract], { approved, proposed: ev.clause });
  }

  // R09
  let days: number | null = null;
  if (bank && invoice && approved) {
    days = calendarDaysBetween(s(invoice.data.invoice_date), s(bank.data.value_date));
    const ok = days >= 0 && days <= approved.window_days;
    add('R09', ok ? 'PASS' : 'FAIL', `Settled ${days} calendar day(s) after invoice date; window is ${approved.window_days} days (inclusive)`, [bank, invoice, contract],
      { invoiceDate: invoice.data.invoice_date, valueDate: bank.data.value_date, days, windowDays: approved.window_days });
  } else add('R09', 'INSUFFICIENT', 'Window cannot be evaluated without an approved term and dates', [bank, invoice]);

  // R10
  let discount: number | null = null; let expectedNet: number | null = null;
  if (bank && invoice && approved) {
    discount = percentOfExact(n(invoice.data.discount_base_minor), approved.rate_bps);
    if (discount === null) add('R10', 'FAIL', 'Discount is not an exact minor-unit amount; rounding treatment requires finance review', [invoice], { base: invoice.data.discount_base_minor, rateBps: approved.rate_bps });
    else {
      expectedNet = n(invoice.data.amount_minor) - discount;
      const ok = expectedNet === n(bank.data.amount_minor);
      add('R10', ok ? 'PASS' : 'FAIL', `${n(invoice.data.discount_base_minor)} × ${approved.rate_bps}bps = ${discount}; expected net ${expectedNet} vs paid ${n(bank.data.amount_minor)}`,
        [invoice, bank, contract], { baseMinor: n(invoice.data.discount_base_minor), rateBps: approved.rate_bps, discountMinor: discount, expectedNetMinor: expectedNet, paidMinor: n(bank.data.amount_minor) });
    }
  } else add('R10', 'INSUFFICIENT', 'Discount cannot be computed without an approved term', [invoice]);

  const outcome: PolicyEvaluation['outcome'] = results.some((r) => r.outcome === 'BLOCK') ? 'BLOCK'
    : results.some((r) => r.outcome === 'FAIL' || r.outcome === 'INSUFFICIENT') ? 'REVIEW' : 'PROPOSE';
  return {
    outcome, results, reasons: results.filter((r) => r.outcome !== 'PASS').map((r) => `${r.ruleId} ${r.name}: ${r.detail}`),
    computed: { residualMinor: residual, discountMinor: discount, expectedNetMinor: expectedNet, daysToSettle: days },
  };
}
