# ExceptionIQ — ERP Module & Workflow Guide

## Product model
ExceptionIQ is a finance-exception ERP workbench. It is not a generic dashboard: every screen answers one of four questions — **what needs attention, what evidence supports it, who owns the next decision, and what financial change is actually being authorized?**

## Role workspaces
### 1. Reconciliation Analyst
**Purpose:** investigate unmatched payments and prepare a resolution.
- Exception queue: prioritize OPEN / NEEDS_REVIEW cases.
- Investigation: controlled read-only evidence gathering.
- Evidence graph: source-linked explanation and contradictions.
- Rules: deterministic eligibility and matching checks.
- Proposal: exact mock adjustment, match and journal.
- Cannot approve their own proposal.

### 2. Finance Controller
**Purpose:** exercise financial control.
- Approval inbox: only proposals requiring a controller decision.
- Financial bridge: Bank paid → ERP expected → eligible adjustment → final residual.
- Evidence review: source records, rules, journal and bindings.
- Approve/reject: decision is bound to exact payload/evidence/policy hashes.
- Execution: only after approval; stale/changed evidence blocks execution.

### 3. Administrator
**Purpose:** operate and test the environment, not approve finance.
- System health: audit chain, unauthorized writes, closed-without-verification.
- Controls & RBAC: permissions, policy rules and legal state transitions.
- Tool registry: allowlisted enterprise tools and boundaries.
- Scenario lab: replay failure variants and reset synthetic data.
- No default approval authority.

## Case workflow
1. **OPEN** — unmatched payment event becomes a case.
2. **INVESTIGATING** — agent proposes hypotheses; analyst reviews the investigation.
3. **AWAITING_APPROVAL** — deterministic rules pass and an exact proposal is created.
4. **APPROVED** — a different controller authorizes the exact payload.
5. **EXECUTING** — restricted executor rechecks approval, evidence and preconditions, then performs the mock write atomically.
6. **VERIFYING** — independent verifier re-reads the source state and checks postconditions.
7. **CLOSED** — only a fully verified result can close.
8. **NEEDS_REVIEW / BLOCKED** — failures, contradictions, changed evidence, rejected approvals or policy violations stop the flow and return ownership to review.

## Financial example
Synthetic case B-104 pays **INR 98,000** while ERP expects **INR 100,000**. Contract C-12 permits a **2% early-payment discount**, equal to **INR 2,000**. Therefore:
- ERP expected settlement = INR 100,000
- Less eligible discount = INR 2,000
- Bank payment = INR 98,000
- Residual after approved adjustment = INR 0

The model can discover/propose the explanation, but deterministic code calculates the amount and eligibility. Financial mutation requires controller approval.

## Evidence and audit
The Evidence Graph links cases, source records, clauses, findings, rule results, proposals, approvals, actions and verification. Audit events record actor, timestamp, tool/correlation ID, policy/model metadata where relevant, source versions and outcomes. The global audit chain is append-only and hash-chained.

## Approval mapping
**System event → Analyst investigates → Analyst proposes → Controller approves/rejects → Executor writes → Verifier independently checks → System closes.**

Approval becomes invalid if the payload, evidence version/hash, policy version or approval expiry changes. Execution uses an idempotency key and fresh preconditions.

## Why this is ERP-like
The UX separates operational work from governance: queues, ownership, financial exposure, approval inboxes, evidence, controls, audit and scenario operations are separate modules, while the case remains the central transaction object.
