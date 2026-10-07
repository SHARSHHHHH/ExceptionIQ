/** Central runtime configuration. Every value has a safe demo default; production must override secrets. */
export const config = {
  databasePath: process.env.DATABASE_PATH ?? './data/exceptioniq.db',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me',
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 480),
  approvalTtlMinutes: Number(process.env.APPROVAL_TTL_MINUTES ?? 1440),
  planner: (process.env.PLANNER ?? (process.env.OPENAI_API_KEY ? 'openai' : 'scripted')) as 'openai' | 'scripted',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  budgets: {
    maxToolCalls: Number(process.env.MAX_TOOL_CALLS ?? 10),
    maxInvestigationMs: Number(process.env.MAX_INVESTIGATION_MS ?? 60_000),
    maxPlannerErrors: 2,
  },
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(','),
  demoMode: process.env.DEMO_MODE !== 'false',
};

/** Injectable clock so approval expiry and timing are testable. */
let clockFn: () => Date = () => new Date();
export const clock = { now: () => clockFn() };
export function setClock(fn: () => Date) { clockFn = fn; }
export function resetClock() { clockFn = () => new Date(); }
