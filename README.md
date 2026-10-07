# ExceptionIQ v3 — governed finance-exception ERP

ExceptionIQ imports bank statements, auto-matches exact payments, turns every mismatch into a case, investigates it with a tool-restricted AI agent, proposes an exact correction, and applies it **only** after a controller with enough authority approves that exact change, then independently verifies the result.

> The model proposes. Deterministic rules decide. An authorized person approves. An independent check confirms.

All data is synthetic. All ledger writes are mock operations. Full specification: [`docs/SPEC_V3.md`](docs/SPEC_V3.md). What changed: [`docs/ROLE_BASED_REBUILD.md`](docs/ROLE_BASED_REBUILD.md). Rules for coding agents (Codex): [`AGENTS.md`](AGENTS.md).

## Quick start

Requires **Node.js 22.13+** (22 LTS or 24 LTS). No native dependencies.

```bash
npm run install:all
npm run dev
```

- App: http://localhost:5173 — pick a persona (password for all: `Demo@2026`)
- API: http://localhost:3001/api/health

### Turn on the OpenAI features (optional)
Create `backend/.env.local`:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
PLANNER=openai
```
Restart `npm run dev`. The top bar shows `AI: <model>`. As admin, use **Scenario lab & AI → Test connection**. Never put the key in the frontend. Without a key every AI feature uses its deterministic engine.

| Command | What it does |
|---|---|
| `npm test` | 99 backend tests (roles, approval limits, ownership, import, AI fallback, governance, audit) |
| `npm run typecheck` | Typecheck backend and frontend |
| `npm run demo` | Headless replay of all 11 scenarios with safety metrics |
| `npm run seed` | Reset the demo database |
| `npm run build && npm start` | Production build and serve |

## Ten-minute demo
1. **Asha (analyst)** → *Import bank statement* → *Load sample from live ledger* → *Preview* → *Import* with auto-investigate. Exact payments auto-match; discounts become proposals; fees, wrong beneficiaries and unknown payees become review/blocked cases.
2. Home → *Auto-investigate my queue*. Open **CASE-104** → *Generate briefing* (investigation coach), add a note, try *Attempt the write before approval* → refused `NOT_APPROVED`.
3. **Ravi (controller, limit ₹5,000)** → *Approval inbox* → CASE-104 → *Approve* → *Apply approved change* → closed after verification. Open **CASE-777** (₹10,000): Approve is disabled — above his limit.
4. **Meera (senior controller)** approves CASE-777 → applied → closed.
5. **Nisha (auditor)**: read-only everywhere; audit chain verified; export a case bundle; *Draft control-test notes*.
6. **Dev (admin)** → *Users & roles*: lower Ravi's limit, deactivate an analyst (their cases are released). Try editing yourself — locked. *Scenario lab*: amend a contract after approval → execution refused `EVIDENCE_CHANGED`.

## Troubleshooting

- **`Error: No such built-in module: node:sqlite`** (or the startup check says your Node is too old) — you are on Node 20, or 22.12 or earlier. Install Node 22 LTS (22.13+) or 24 LTS:
  - Windows with [nvm-windows](https://github.com/coreybutler/nvm-windows): `nvm install 22` then `nvm use 22`
  - macOS/Linux with nvm: `nvm install 22` then `nvm use 22`
  - or the LTS installer from https://nodejs.org

  Open a **new** terminal, confirm with `node -v`, delete `backend/.next`, and run `npm run dev` again. `npm run dev`, `start`, `build` and `test` now check the version first and stop with these instructions.
- **`[vite] http proxy error ... ECONNREFUSED`** during the first start — the web app is ready before the API. The first backend start can take 20–30 seconds while Next.js compiles. The sign-in page waits and fills in the personas when the API is up; no reload needed.

- **"ExperimentalWarning: SQLite is an experimental feature"** — printed by Node for `node:sqlite`. It is harmless for this MVP; see `docs/SPEC.md` D2.
- **"The API is not reachable"** on the sign-in screen — the backend isn't running on port 3001. Use `npm run dev` from the repository root, which starts both.
- **Old database after upgrading** — rebuilt automatically when the schema version changes (you'll see a one-line warning).
- **Reset everything** — `npm run seed`, or sign in as the administrator and use Replay lab → Reset demo data.

## Documentation

- [`docs/RESEARCH.md`](docs/RESEARCH.md) — base research: market, controls practice, security guidance, accounting treatment, and what it means for the design
- [`docs/SPEC.md`](docs/SPEC.md) — specification: architecture, decisions, data model, state machine, rules, API, security model, test plan
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — demo walkthrough and scenario table
- [`docs/test-report.json`](docs/test-report.json) — machine-readable test results from the last run

## Repository layout

```
backend/
  src/
    domain/      exact money, calendar dates, state machine, types
    db/          SQLite schema (append-only audit triggers) and connection
    fixtures/    10 synthetic scenarios, demo users, seeding
    security/    passwords, signed sessions, RBAC, redaction, injection screening
    audit/       hash-chained audit log + verification
    tools/       tool contracts (allowlist), mock source adapters, the gateway
    graph/       Evidence Graph writer with provenance invariants
    rules/       AP-DISCOUNT rule pack v1.2.0, clause extractor
    agent/       planner interface, deterministic planner, OpenAI planner
    workflow/    investigate, approvals, execute, verify, queries, admin
    http/        route wrapper (auth, validation, error mapping)
  app/api/       Next.js route handlers (thin adapters)
  scripts/       demo replay, seed, MCP server
  tests/         Vitest suites
frontend/src/    React workbench (pages, Evidence Graph, lifecycle)
docs/            research, spec, demo script, test report
```

## What changed from v1

v1 was a UI prototype: status strings were flipped by one endpoint, "PASS" badges were hardcoded, any email/password signed in, anyone could approve, and `/api/data` returned the whole database without authentication. v2 implements the governance the idea document describes and proves it with tests. See `docs/SPEC.md` §1 for the gap analysis.

## Screenshots

| | |
|---|---|
| ![Closed case with evidence chain](docs/screenshots/closed-evidence-graph.png) | ![Controller approval with injection flag](docs/screenshots/controller-approval.png) |
| ![Denied payment.release in agent trace](docs/screenshots/injection-denied.png) | ![Sign in](docs/screenshots/sign-in.png) |
