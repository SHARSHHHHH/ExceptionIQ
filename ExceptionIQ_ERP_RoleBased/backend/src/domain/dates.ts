/** Calendar-date helpers on ISO YYYY-MM-DD strings, evaluated in UTC so results never depend on server timezone. */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(s: string): number {
  if (!ISO.test(s)) throw new Error(`Invalid ISO date: ${s}`);
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t).toISOString().slice(0, 10);
  if (back !== s) throw new Error(`Invalid calendar date: ${s}`);
  return t;
}

/** Whole calendar days from `from` to `to` (to - from). */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to) - parseIsoDate(from)) / 86_400_000);
}

export function isWithin(date: string, start: string, end: string | null): boolean {
  const t = parseIsoDate(date);
  return t >= parseIsoDate(start) && (end === null || t <= parseIsoDate(end));
}
