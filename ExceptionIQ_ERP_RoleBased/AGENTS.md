# AGENTS.md — instructions for Codex and other coding agents

ExceptionIQ is a governed finance-exception ERP. Treat this file as binding when changing the repo.

## Commands (run before every commit)
- `npm run install:all` — install root, backend, frontend
- `npm test` — backend Vitest suite (must stay green; 99+ tests)
- `npm run typecheck` — backend + frontend `tsc --noEmit` (must be clean; `noUnusedLocals` is on)
- `npm run build` — Next.js API build + Vite build
- `npm run demo` — headless replay of all 11 scenarios; `unauthorizedWrites` must be 0

## Non-negotiable invariants
1. Permissions live ONLY in `backend/src/security/rbac.ts`. Every service function calls `requirePermission`. The UI mirrors `/api/auth/me` and the per-case `viewer` block; never add a UI-only check.
2. ADMIN and AUDITOR never gain `approval:decide`, `case:investigate`, `execution:trigger` or `ingest:statement`.
3. Approvals bind payload hash + evidence hash + policy version, respect `approval_limit_minor`, and the executor re-checks all of them.
4. The model (OpenAI) is advisory: it may only call READ tools through `ToolGateway`; its output is validated; it never writes, approves or executes.
5. Money is integer minor units. No floats. Use `toMinor` / `percentOfExact`.
6. `audit_events` is append-only and hash-chained. Every state change appends an event.
7. Changing the DB schema? Bump `SCHEMA_VERSION` in `backend/src/db/schema.ts`.
8. Every lucide-react icon you render must be imported (missing imports caused the v2 "X is not defined" crash). `npm run typecheck` catches this.

## Where things are
backend/src: `security/` (RBAC, sessions) · `workflow/` (investigate, approvals, execute, verify, cases, users, automation, queries) · `ingest/` (bank statement import) · `ai/` (OpenAI client, copilot) · `agent/` (planners) · `rules/` (policy pack) · `tools/` (gateway)
frontend/src: `pages/` one file per screen · `components/` shared · `App.tsx` routes + guards + per-screen error boundary

## Adding a feature checklist
permission in rbac.ts → service function with `requirePermission` + audit event → route in `app/api` with a strict zod body → test in `backend/tests` (allowed role AND denied role) → UI behind `can()`/`viewer` → typecheck → test.
