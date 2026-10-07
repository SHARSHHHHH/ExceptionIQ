/**
 * Exact money arithmetic. Amounts are integers in minor units (paise for INR).
 * Percentages are integer basis points. No floating point ever touches an amount.
 */
export class MoneyError extends Error {}

export function assertMinor(n: number, label = 'amount'): number {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${label} must be a safe integer in minor units, got ${n}`);
  return n;
}

/** Returns the exact discount or null if the result is not an exact number of minor units (rounding is a policy decision, not ours). */
export function percentOfExact(baseMinor: number, rateBps: number): number | null {
  assertMinor(baseMinor, 'base');
  assertMinor(rateBps, 'rateBps');
  const product = BigInt(baseMinor) * BigInt(rateBps);
  if (product % 10000n !== 0n) return null;
  return Number(product / 10000n);
}

export function formatMinor(minor: number, currency: string): string {
  const major = minor / 100;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(major);
}
