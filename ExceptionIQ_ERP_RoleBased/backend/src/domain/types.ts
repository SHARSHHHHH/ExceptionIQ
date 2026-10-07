export type Role = 'ANALYST' | 'CONTROLLER' | 'ADMIN' | 'AUDITOR';
export const ROLES: Role[] = ['ANALYST', 'CONTROLLER', 'ADMIN', 'AUDITOR'];

export const CASE_STATUSES = [
  'OPEN', 'INVESTIGATING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'VERIFYING',
  'CLOSED', 'NEEDS_REVIEW', 'BLOCKED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export type RuleOutcome = 'PASS' | 'FAIL' | 'BLOCK' | 'INSUFFICIENT';

export interface RuleResult {
  ruleId: string;
  name: string;
  version: string;
  outcome: RuleOutcome;
  detail: string;
  /** IDs of source records the rule read. */
  sources: string[];
  /** Deterministic inputs/outputs for reproducibility. */
  facts: Record<string, unknown>;
}

export type HypothesisStatus = 'UNTESTED' | 'SUPPORTED' | 'REJECTED' | 'INCONCLUSIVE';
export interface Hypothesis {
  code: 'EARLY_PAYMENT_DISCOUNT' | 'BANK_FEE' | 'PARTIAL_PAYMENT' | 'DUPLICATE_SETTLEMENT' | 'WRONG_REFERENCE';
  title: string;
  supportingEvidence: string;
  rejectingEvidence: string;
  status: HypothesisStatus;
  note?: string;
}

export interface Actor {
  id: string;
  name: string;
  role: Role | 'SERVICE';
  entityIds: string[];
  /** Delegation-of-authority limit for approvals, in minor units. Only meaningful for controllers. */
  approvalLimitMinor?: number;
  title?: string;
}

export class DomainError extends Error {
  constructor(public code: string, message: string, public httpStatus = 409, public details?: unknown) {
    super(message);
  }
}
