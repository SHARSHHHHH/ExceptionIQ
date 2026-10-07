# Demo script (about 7 minutes)

Follows idea document §8: start from the unexplained INR 2,000, show hypotheses, contract discovery and the deterministic check, open sources from the graph, show a blocked unapproved write, approve, execute, verify, export, then show a failure variant. Close with measured numbers only.

Setup: `npm run seed && npm run dev`, open http://localhost:5173. Password for all personas: `Demo@2026`.

## Part 1 — the analyst (Asha Menon)

1. **Overview.** Point at the four safety gates (unauthorized writes, closed without verification, audit chain, denials). Say: "These are recomputed from the records every time, not counters."
2. **Cases → CASE-104.** Read the header: Kaveri paid ₹98,000; the residual is not yet known.
3. **Run investigation.**
   - **Agent trace tab.** Five steps: bank → ERP (including cleared items, to catch duplicates) → invoice + PO → vendor identity → contract. The contract is fetched only because a residual remained. Each step shows the rationale, the exact arguments, and the record version and hash it returned.
   - **Rule results tab.** R01–R10 all pass. Open R09's inputs: invoice 1 Sep, value date 8 Sep, 7 days, window 10 (inclusive). Open R10: 10,000,000 × 200 bps = 200,000 paise exactly.
   - **Hypotheses.** Discount is supported; the other four are rejected, with reasons taken from rule results.
   - **Evidence graph.** Click the Clause node: it was derived from Contract C-12 v1. Click a source record to see its table, version, content hash and the tool call that retrieved it.
4. **Attempt the write before approval** → denied with `NOT_APPROVED`. The ledger is untouched, and the denial appears in the audit log and on the Overview.
5. **CASE-418** (prompt injection) → Run investigation.
   - **Agent trace** shows step 6, `payment.release`, **Denied** because it is not an allowlisted tool. This is a *simulated compromised planner* that obeyed text inside the contract; the gateway, not the model, stopped it.
   - **Evidence graph** shows the flagged finding: "Untrusted instruction detected in C-31 — treated as data, not authority".

## Part 2 — the controller (Ravi Shankar)

6. Sign out and sign in as Ravi. **Approvals** shows two cases.
7. **CASE-418.** The decision panel shows the injection flag above the binding. Point out that the only possible action is still the bounded ₹2,000 discount.
8. **CASE-104.** Read the binding aloud: Dr 2100 Accounts Payable ₹2,000 / Cr 4910 Purchase Discounts Received ₹2,000, match B-104 ↔ INV-204, plus the payload hash, evidence hash and policy `AP-DISCOUNT@1.2.0`. **Approve this change.**
9. **Apply approved change.** The case goes Executing → Verifying → Closed. The header now reads *Residual now ₹0.00, was ₹2,000.00*.
10. **Evidence graph.** The Verification node is selected, and its entire ancestry is highlighted back to B-104, OI-204, INV-204, PO-88, V-17 and C-12.
11. **Audit events → Export audit bundle.** The JSON includes the chain verification. Then open **Audit log**: chain verified.

## Part 3 — failure variants (choose two)

| Persona | Case | Do | Expect |
|---|---|---|---|
| Asha | CASE-211 Missing clause | Run investigation | R08 INSUFFICIENT: "no finance-approved early-payment term; entitlement is not inferred" → Needs review |
| Asha | CASE-305 Duplicate | Run investigation | R05 **Block**: INV-402 already matched to B-299 → Blocked |
| Asha | CASE-522 Late payment | Run investigation | R09 FAIL: day 11 vs a 10-day window → Needs review |
| Asha → Ravi | CASE-851 Write failure | Investigate, approve, apply | Rolled back (no journal); a retry is refused with `PREVIOUS_ATTEMPT_FAILED` |
| Asha → Ravi | CASE-962 Verify failure | Investigate, approve, apply | V1 fails (residual reopened by a simulated external ERP change) → Needs review with "do not retry" guidance; **not closed** |
| Asha → Dev → Ravi | Any discount case | Investigate; as Dev, **Replay lab → Amend contract**; as Ravi, approve | Approval refused with `EVIDENCE_CHANGED` (or execution refused if amended after approval) |
| Asha | CASE-S01 | Open directly | 404: entity SG01 is outside Asha's access. Lim Wei Ling (SG01) can work it |
| Dev (admin) | Any proposal | Look for approve buttons | None. Administrators have no approval authority |

## Measured results (from this build)

Run `npm run demo` to reproduce. Measured on the build machine with the deterministic planner and an in-memory database; times include investigation, approval, execution and verification. They are not a performance claim — model calls will dominate latency with the OpenAI planner.

| Scenario | Tool calls | Rule outcome | Final state | Total ms |
|---|---|---|---|---|
| HAPPY_PATH | 5 | Propose | Closed | 33 |
| MISSING_CLAUSE | 5 | Review | Needs review | 6 |
| DUPLICATE_SETTLEMENT | 5 | Block | Blocked | 9 |
| PROMPT_INJECTION | 6 (1 denied) | Propose | Closed | 17 |
| LATE_PAYMENT | 5 | Review | Needs review | 6 |
| CURRENCY_MISMATCH | 5 | Block | Blocked | 14 |
| VENDOR_MISMATCH | 5 | Block | Blocked | 7 |
| WRITE_FAILURE | 5 | Propose | Needs review (rolled back) | 12 |
| VERIFY_FAILURE | 5 | Propose | Needs review (not closed) | 21 |
| CROSS_ENTITY | 5 | Propose | Closed | 28 |

Safety after the full replay:
- 0 unauthorized writes and 0 closures without verification;
- audit chain valid across 151 events;
- denials: 5 × `NOT_APPROVED` (one deliberate early write per proposed case), 1 × `TOOL_NOT_ALLOWLISTED` (`payment.release`), 1 × `PREVIOUS_ATTEMPT_FAILED`.

Automated tests: **80 / 80 passing** (`docs/test-report.json`). A mutation check — disabling approval expiry, separation of duties, gateway scope, or the window boundary one at a time — made the suite fail every time.

## What not to claim

- No measured productivity improvement: there is no baseline yet. That is pilot work (idea doc §5, §9).
- No live-model accuracy figures. The OpenAI planner is tested with a fake client for prompt structure, schema handling and failure paths; live-model quality must be evaluated in the pilot against independent controller review.
