# ExceptionIQ v3 — specification

## 1. Purpose
Investigate unmatched vendor payments, prove the explanation from source records, and apply a correction only after an authorized controller approves the exact change and an independent verifier confirms it. v3 adds four-role RBAC with delegation of authority, case ownership, bank-statement automation, and OpenAI-assisted features that never hold authority.

## 2. Roles and permissions (enforced server-side, `backend/src/security/rbac.ts`)

| Permission | Analyst | Controller | Auditor | Admin |
|---|:-:|:-:|:-:|:-:|
| case:read | ✓ | ✓ | ✓ | ✓ |
| case:claim / case:investigate / automation:batch | ✓ | | | |
| case:assign | | ✓ | | |
| case:comment | ✓ | ✓ | ✓ | |
| approval:decide (within limit) | | ✓ | | |
| execution:trigger | ✓ | ✓ | | |
| ingest:statement | ✓ | ✓ | | |
| audit:read | | ✓ | ✓ | ✓ |
| audit:export | | ✓ | ✓ | |
| tools:read | ✓ | | ✓ | ✓ |
| ai:assist | ✓ | ✓ | ✓ | ✓ |
| ai:configure, admin:users, admin:reset, admin:simulate | | | | ✓ |

Entity scope: every user sees only cases of their entities (out-of-scope = 404).

### Separation-of-duties rules (each has a test)
| Rule | Error code |
|---|---|
| Investigator/proposer cannot approve | SEPARATION_OF_DUTIES |
| Approval amount must be ≤ controller's limit | APPROVAL_LIMIT_EXCEEDED |
| Approver must still hold authority at execution time | APPROVER_AUTHORITY_REVOKED |
| A case owned by another analyst cannot be investigated/claimed | CASE_ASSIGNED_TO_OTHER |
| Assignee must be an active analyst in the case entity | INVALID_ASSIGNEE |
| Admin cannot modify own account | SELF_MODIFICATION |
| Only controllers hold approval limits | SOD_APPROVAL_LIMIT |
| Last active admin cannot be removed | LAST_ADMIN |
| Deactivated users are locked out on next request | UNAUTHENTICATED / ACCOUNT_DISABLED |

## 3. Demo users (password `Demo@2026`)
| User | Role | Entities | Limit |
|---|---|---|---|
| Asha Menon, Karan Iyer | Analyst | IN01 | — |
| Ravi Shankar | Controller | IN01 | ₹5,000 |
| Meera Krishnan | Senior controller | IN01 | ₹5,00,000 |
| Lim Wei Ling | Analyst | SG01 | — |
| Tan Mei Hua | Controller | SG01 | S$50,000 |
| Nisha Varghese | Auditor | IN01, SG01 | — |
| Dev Raghavan | Admin | IN01, SG01 | — |

## 4. Case lifecycle
OPEN → INVESTIGATING → AWAITING_APPROVAL → APPROVED → EXECUTING → VERIFYING → CLOSED, with NEEDS_REVIEW / BLOCKED exits. Closure only from VERIFYING after all six verification checks pass.

## 5. Bank-statement automation (`backend/src/ingest/statement.ts`)
CSV header: `external_id,value_date,amount,currency,counterparty,reference,beneficiary_account`.
Per line: validated (exact decimal → minor units) → internal id derived from (entity, external_id) so re-imports are duplicates →
- exact amount, verified beneficiary, single open item, same currency → **AUTO-MATCH@1.0.0** (clears item, no journal, no P&L)
- short payment → cash applied, SHORT_PAYMENT case
- otherwise → OVER_PAYMENT / NO_MATCH / DUPLICATE_PAYMENT / CURRENCY_MISMATCH / BENEFICIARY_MISMATCH case.
Option "auto-investigate" runs the governed investigation on each new case. "Load sample" builds a realistic statement from the live unpaid ledger and tops the ledger up when it runs low.

## 6. AI (OpenAI) usage — `OPENAI_API_KEY` in `backend/.env.local`
| Feature | With key | Without key |
|---|---|---|
| Investigation planner (`PLANNER=openai`) | model picks READ tools via gateway | deterministic planner |
| Clause extraction | model + deterministic cross-check (conflict → review) | regex extractor |
| Case briefing (role-specific: coach / approval memo / control-test notes / control health) | model, schema-constrained | rules engine |
| Daily workload briefing | model | rules engine |
| Free-form statement parsing | model extracts rows for human review | CSV only |
| Explanation drafting | model | template |
Safeguards: data redacted before sending; strict JSON schema; output clipped and validated; failure falls back to rules; every AI use audited; the model cannot write, approve or execute.

## 7. API (all JSON, Bearer token)
auth: `POST /auth/login`, `GET /auth/me`, `GET /auth/personas`
cases: `GET /cases`, `GET /cases/:id` (includes `viewer` capabilities), `POST /cases/:id/{investigate,claim,assign,notes,decision,execute,assist}`, `GET /cases/:id/{assignees,export}`
automation: `POST /automation/investigate-queue`
ingest: `POST /ingest/statement`, `POST /ingest/parse`, `GET /ingest/{sample,ledger,batches}`
ai: `GET /ai/status`, `POST /ai/briefing`, `POST /ai/test`
admin: `GET /admin/users`, `POST /admin/users/:id`, `POST /admin/reset`, `POST /admin/simulate-change`
other: `GET /metrics`, `GET /audit`, `GET /catalog`, `GET /health`

## 8. Verification status
- Backend: 99/99 tests (roles, DoA, ownership, user admin, import, AI fallback + the original governance suites); typecheck clean.
- Frontend: typecheck clean; production build OK.
- API: `next build` OK (30 routes).
- Browser E2E (Playwright): all 5 personas opened every screen in their navigation with zero crashes and zero refused API calls; import → auto-investigate → approve → apply → verified close worked; Ravi blocked above his limit, Meera approved; auditor saw no action buttons; admin AI-test and audit-chain pages OK.
