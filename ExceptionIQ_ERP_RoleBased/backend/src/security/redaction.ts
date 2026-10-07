/** Mask long digit runs (account numbers, card-like values) before data reaches a model or a log. */
export function maskAccount(ref: string): string {
  return ref.length <= 4 ? '****' : `${'X'.repeat(Math.max(0, ref.length - 4))}${ref.slice(-4)}`;
}

export function redactText(text: string): string {
  return text.replace(/\b\d{8,}\b/g, (m) => maskAccount(m));
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
