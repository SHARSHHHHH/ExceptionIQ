import { createHash, randomUUID } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively, so equal content always hashes equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]));
  }
  return v;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hashOf = (v: unknown) => sha256(canonicalJson(v));
export const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
