import { CaseStatus, DomainError } from './types';

/**
 * The only legal case transitions. Anything not listed is rejected.
 * Closure is reachable only from VERIFYING, i.e. only after an independent verification.
 */
export const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['AWAITING_APPROVAL', 'NEEDS_REVIEW', 'BLOCKED'],
  AWAITING_APPROVAL: ['APPROVED', 'NEEDS_REVIEW'],
  APPROVED: ['EXECUTING', 'NEEDS_REVIEW'],
  EXECUTING: ['VERIFYING', 'NEEDS_REVIEW'],
  VERIFYING: ['CLOSED', 'NEEDS_REVIEW'],
  NEEDS_REVIEW: ['INVESTIGATING'],
  BLOCKED: ['INVESTIGATING'],
  CLOSED: [],
};

export function assertTransition(from: CaseStatus, to: CaseStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new DomainError('ILLEGAL_TRANSITION', `Case cannot move from ${from} to ${to}`, 409, { from, to });
  }
}

export const canTransition = (from: CaseStatus, to: CaseStatus) => TRANSITIONS[from]?.includes(to) ?? false;
