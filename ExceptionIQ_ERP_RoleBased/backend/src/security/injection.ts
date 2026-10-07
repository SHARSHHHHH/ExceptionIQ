/**
 * Content screening for instructions embedded in retrieved documents.
 * IMPORTANT: this is a *detector* that raises a visible finding. It is NOT the security boundary.
 * The boundary is architectural: tool allowlists, server-side authorization, approval binding,
 * and an executor that independently re-checks every invariant (OWASP LLM01 / LLM06).
 */
const PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'override-instructions', re: /\bignore\b.{0,40}\b(policy|policies|instructions?|rules?|controls?)\b/i },
  { id: 'payment-release', re: /\b(release|transfer|send|wire)\b.{0,30}\bpayment\b/i },
  { id: 'approval-bypass', re: /\b(bypass|skip|without)\b.{0,30}\b(approval|review|controller)\b/i },
  { id: 'system-impersonation', re: /\b(system (note|prompt|message)|assistant:|as an ai)\b/i },
  { id: 'bank-detail-change', re: /\b(change|update)\b.{0,30}\b(bank|beneficiary|account)\b.{0,20}\bdetails?\b/i },
];

export interface InjectionSignal { patternId: string; excerpt: string }

export function screenForInstructions(text: string): InjectionSignal[] {
  const out: InjectionSignal[] = [];
  for (const { id, re } of PATTERNS) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      const start = Math.max(0, m.index - 20);
      out.push({ patternId: id, excerpt: text.slice(start, m.index + m[0].length + 20).trim() });
    }
  }
  return out;
}
