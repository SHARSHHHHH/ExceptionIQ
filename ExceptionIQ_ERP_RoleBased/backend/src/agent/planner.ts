import type { Hypothesis } from '../domain/types';
import type { ClauseProposal } from '../rules/clauseExtractor';

export interface EvidenceView { kind: string; id: string; version: number; fields: Record<string, unknown> }
export interface StepView { tool: string; args: unknown; decision: string; summary: string }

export interface PlannerContext {
  caseId: string;
  bankTxnId: string;
  evidence: EvidenceView[];   // REDACTED, untrusted
  history: StepView[];
  allowedTools: { name: string; description: string; boundary: string }[];
  remainingCalls: number;
}

export type PlannerStep =
  | { kind: 'call'; tool: string; args: unknown; rationale: string }
  | { kind: 'finish'; rationale: string };

export interface ExplanationInput { caseId: string; outcome: string; reasons: string[]; computed: Record<string, unknown>; evidence: EvidenceView[] }

/**
 * A planner proposes; it never decides. Its outputs are validated by the gateway (tools),
 * the rule pack (eligibility) and the approval service (authority).
 */
export interface Planner {
  readonly name: string;
  readonly model: string | null;
  readonly promptVersion: string;
  hypotheses(ctx: PlannerContext): Promise<Hypothesis[]>;
  nextStep(ctx: PlannerContext): Promise<PlannerStep>;
  extractClause(contractText: string): Promise<ClauseProposal | null>;
  draftExplanation(input: ExplanationInput): Promise<string>;
}

export class PlannerError extends Error {}

export const BASE_HYPOTHESES: Hypothesis[] = [
  { code: 'EARLY_PAYMENT_DISCOUNT', title: 'Eligible early-payment discount taken by payer', status: 'UNTESTED',
    supportingEvidence: 'Effective contract clause, approved term, settlement inside window, exact discount equals residual',
    rejectingEvidence: 'No approved term, settlement outside window, or amount mismatch' },
  { code: 'BANK_FEE', title: 'Bank or remittance fee deducted', status: 'UNTESTED',
    supportingEvidence: 'Fee line on bank statement; residual equals fee schedule',
    rejectingEvidence: 'Residual fully explained by another cause' },
  { code: 'PARTIAL_PAYMENT', title: 'Partial payment with balance outstanding', status: 'UNTESTED',
    supportingEvidence: 'Remittance advice or later payment for the balance',
    rejectingEvidence: 'Residual fully explained by a contractual entitlement' },
  { code: 'DUPLICATE_SETTLEMENT', title: 'Invoice already settled by another payment', status: 'UNTESTED',
    supportingEvidence: 'Existing payment match or CLEARED open item',
    rejectingEvidence: 'Open item OPEN and no prior match' },
  { code: 'WRONG_REFERENCE', title: 'Payment applied to the wrong invoice or vendor', status: 'UNTESTED',
    supportingEvidence: 'Beneficiary or reference mismatch',
    rejectingEvidence: 'Beneficiary fingerprint and invoice linkage verified' },
];
