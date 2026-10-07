/**
 * Deterministic clause extractor. It PROPOSES a structured term from contract text;
 * it never decides eligibility. Rule R08 compares any proposal against finance-approved terms.
 */
export interface ClauseProposal { rate_bps: number; window_days: number; sentence: string; extractor: string }

/** Convert a decimal percent string ("2", "1.5", "2.25") to integer basis points exactly. */
export function percentTextToBps(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return whole * 100 + Number(frac);
}

export function extractDiscountClause(text: string): ClauseProposal | null {
  const sentences = text.split(/(?<=\.)\s+/);
  for (const s of sentences) {
    if (!/discount/i.test(s)) continue;
    const pct = s.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    const days = s.match(/within\s+(\d{1,3})\b(?:\s*\([^)]*\))?\s*(?:calendar\s+)?days?/i);
    if (pct && days) {
      const bps = percentTextToBps(pct[1]);
      if (bps === null) continue;
      return { rate_bps: bps, window_days: Number(days[1]), sentence: s.trim(), extractor: 'regex-v1' };
    }
  }
  return null;
}
