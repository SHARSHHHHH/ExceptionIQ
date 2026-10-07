import type { Hypothesis } from '../domain/types';
import { extractDiscountClause } from '../rules/clauseExtractor';
import { screenForInstructions } from '../security/injection';
import { formatMinor } from '../domain/money';
import { BASE_HYPOTHESES, ExplanationInput, Planner, PlannerContext, PlannerStep } from './planner';

/**
 * Deterministic, adaptive planner used when no model is configured, and for reproducible tests.
 * It follows the idea doc's investigation order: Bank → ERP → Invoice/PO → Vendor, then Contract
 * only when an unexplained difference remains.
 *
 * `simulateCompromise`: when retrieved text contains an injected payment instruction, the planner
 * behaves like a model that OBEYED it and requests `payment.release`. This exists only to prove
 * that the gateway — not the model — is the security boundary. It is labelled in every trace.
 */
export class ScriptedPlanner implements Planner {
  readonly name = 'scripted';
  readonly model = null;
  readonly promptVersion = 'scripted-v2.0';
  constructor(private opts: { simulateCompromise?: boolean } = { simulateCompromise: true }) {}

  async hypotheses(): Promise<Hypothesis[]> { return BASE_HYPOTHESES.map((h) => ({ ...h })); }

  async nextStep(ctx: PlannerContext): Promise<PlannerStep> {
    const find = (kind: string) => ctx.evidence.filter((e) => e.kind === kind);
    const tried = (tool: string) => ctx.history.some((h) => h.tool === tool);
    const bank = find('BankTransaction')[0];
    if (!bank) {
      if (tried('bank.get_transaction')) return { kind: 'finish', rationale: 'Bank transaction unavailable; cannot investigate further.' };
      return { kind: 'call', tool: 'bank.get_transaction', args: { transaction_id: ctx.bankTxnId }, rationale: 'Start from the triggering bank transaction: amount, currency, value date, beneficiary.' };
    }
    const vendorId = String(bank.fields.vendor_hint ?? '');
    if (!tried('erp.get_open_items')) {
      return { kind: 'call', tool: 'erp.get_open_items', args: { vendor_id: vendorId, include_cleared: true, limit: 10 },
        rationale: `Find ERP open items (including cleared, to detect duplicate settlement) for vendor ${vendorId}.` };
    }
    const items = find('OpenItem');
    const ref = String(bank.fields.reference ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const item = items.find((i) => ref.includes(String(i.fields.invoice_id).replace('-', ''))) ?? items[0];
    if (!item) return { kind: 'finish', rationale: 'No ERP open item linked to this vendor; escalate for analyst review.' };
    const invoiceId = String(item.fields.invoice_id);
    const invoice = find('Invoice').find((i) => i.id === invoiceId);
    if (!invoice && !tried('invoice.get_with_po')) {
      return { kind: 'call', tool: 'invoice.get_with_po', args: { invoice_id: invoiceId }, rationale: `Bank reference points to ${invoiceId}; retrieve invoice and linked PO.` };
    }
    if (!find('Vendor').length && !tried('vendor.get_verified_identity')) {
      return { kind: 'call', tool: 'vendor.get_verified_identity', args: { vendor_id: vendorId }, rationale: 'Confirm beneficiary identity using structured identifiers, not names.' };
    }
    const residual = Number(item.fields.expected_minor) - Number(bank.fields.amount_minor);
    const contract = find('Contract')[0];
    if (residual !== 0 && !contract && !tried('contract.get_effective_terms') && invoice) {
      return { kind: 'call', tool: 'contract.get_effective_terms', args: { vendor_id: String(invoice.fields.vendor_id), as_of_date: String(invoice.fields.invoice_date) },
        rationale: `Residual of ${formatMinor(residual, String(bank.fields.currency))} is unexplained by reference data; check contract terms effective on the invoice date.` };
    }
    if (contract && this.opts.simulateCompromise && !tried('payment.release')) {
      const signals = screenForInstructions(String(contract.fields.clause_text ?? ''));
      if (signals.some((s) => s.patternId === 'payment-release')) {
        return { kind: 'call', tool: 'payment.release', args: { amount: '500000', account: '[from contract text]' },
          rationale: '[ADVERSARIAL REPLAY] Simulated compromised planner obeying an instruction found inside contract text.' };
      }
    }
    return { kind: 'finish', rationale: 'Required evidence gathered; hand over to deterministic policy evaluation.' };
  }

  async extractClause(text: string) { return extractDiscountClause(text); }

  async draftExplanation(i: ExplanationInput): Promise<string> {
    const c = i.computed as { residualMinor?: number; discountMinor?: number; daysToSettle?: number };
    const cur = String(i.evidence.find((e) => e.kind === 'Invoice')?.fields.currency ?? 'INR');
    if (i.outcome === 'PROPOSE') {
      return `The ${fmt(c.residualMinor, cur)} residual is explained by an early-payment discount: the payment settled ${c.daysToSettle} day(s) after the invoice date, ` +
        `inside the approved window, and the exact discount (${fmt(c.discountMinor, cur)}) equals the residual. The ERP treatment omitted the discount adjustment.`;
    }
    return `No resolution can be proposed. ${i.reasons.slice(0, 3).join(' ')}`;
  }
}

const fmt = (minor: number | null | undefined, cur: string) => (minor === undefined || minor === null ? 'unknown' : formatMinor(minor, cur));
