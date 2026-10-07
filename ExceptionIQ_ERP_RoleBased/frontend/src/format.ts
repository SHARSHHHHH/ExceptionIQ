import type { CaseStatus } from './types';

export function money(minor: number | null | undefined, currency = 'INR'): string {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-SG', { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}
export const dateTime = (iso: string | null | undefined) => !iso ? '—' : new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const time = (iso: string | null | undefined) => !iso ? '—' : new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const shortHash = (h?: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—');

export const STATUS_LABEL: Record<CaseStatus, string> = {
  OPEN: 'Open', INVESTIGATING: 'Investigating', AWAITING_APPROVAL: 'Awaiting approval', APPROVED: 'Approved', EXECUTING: 'Executing',
  VERIFYING: 'Verifying', CLOSED: 'Closed — verified', NEEDS_REVIEW: 'Needs review', BLOCKED: 'Blocked by policy',
};
export const ROLE_LABEL = { ANALYST: 'Reconciliation analyst', CONTROLLER: 'Finance controller', ADMIN: 'Administrator', AUDITOR: 'Internal auditor' } as const;
export const EXCEPTION_LABEL: Record<string, string> = {
  SHORT_PAYMENT: 'Short payment', OVER_PAYMENT: 'Over payment', NO_MATCH: 'No matching invoice', DUPLICATE_PAYMENT: 'Duplicate payment',
  CURRENCY_MISMATCH: 'Currency mismatch', BENEFICIARY_MISMATCH: 'Beneficiary mismatch',
};
/** Parse a user-typed major-unit amount ("5,000.50") to minor units without floating point. */
export function toMinor(text: string): number | null {
  const m = text.replace(/[,\s₹$]/g, '').match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}

/** Map any status-like string to a tone used by pills and graph nodes. */
export function tone(s?: string | null): 'good' | 'bad' | 'warn' | 'info' | 'neutral' {
  if (!s) return 'neutral';
  if (['PASS', 'SUPPORTED', 'APPROVED', 'SUCCEEDED', 'PASSED', 'CLOSED', 'ALLOWED', 'EXECUTED'].includes(s)) return 'good';
  if (['FAIL', 'BLOCK', 'BLOCKED', 'CONTRADICTED', 'REJECTED', 'FAILED', 'DENIED', 'ERROR'].includes(s)) return 'bad';
  if (['INSUFFICIENT', 'FLAGGED', 'NEEDS_REVIEW', 'INCONCLUSIVE', 'SUPERSEDED'].includes(s)) return 'warn';
  if (['AWAITING_APPROVAL', 'PENDING_APPROVAL', 'INVESTIGATING', 'EXECUTING', 'VERIFYING', 'OPEN', 'UNTESTED'].includes(s)) return 'info';
  return 'neutral';
}
export const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
