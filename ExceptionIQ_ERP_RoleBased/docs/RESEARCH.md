# ExceptionIQ — base research

Prepared October 2026 to ground the v2 build. Sources were retrieved by web search; claims are paraphrased and linked. Nothing here is customer validation — the idea document correctly treats pilot outcomes as hypotheses.

## 1. Market: agentic reconciliation is now a crowded category

The category moved quickly during 2026, which changes how ExceptionIQ should be positioned.

- Trintech announced three financial-close agents on 28 September 2026, one of them an **Exception Management Agent**. It describes its design tenets as end-to-end execution, explainable and audit-ready outputs, and finance staff remaining in the loop at defined review and approval points. ([Unite.AI](https://www.unite.ai/?p=475110))
- According to a CPA Practice Advisor piece from August 2026, BlackLine made its Verity Prepare agents generally available in July 2026, FloQast launched close agents in March 2025, Microsoft has an account-reconciliation agent in preview for Dynamics 365, and Workday has announced a financial-close agent for 2026. The same article cites a KPMG survey (March 2026, 1,013 senior finance leaders) in which active AI use in finance rose from 30% in 2024 to 75%. ([CPA Practice Advisor](https://www.cpapracticeadvisor.com/?p=188496))
- KPMG frames the "agentic close" as exception-first rather than human-free, with human validation, approval thresholds and segregation of duties built into each agent workflow. ([KPMG](https://kpmg.com/us/en/articles/2026/take-command-of-the-financial-close.html))
- Vendors such as HighRadius market traceability from exception through resolution to journal posting as a core capability. ([HighRadius](https://www.highradius.com/product/reconciliation-software/))

**Implication.** "An AI agent that investigates reconciliation exceptions" is no longer differentiating by itself, and the idea document is right not to claim market uniqueness. ExceptionIQ's defensible angle is *provable* governance: controls that are enforced in code and demonstrated by failing-path tests, not described in a slide. Concretely, that means:

- approvals bound to an exact payload, evidence version and policy version;
- an executor that independently re-checks every invariant;
- closure only after independent verification;
- a tamper-evident audit trail;
- safety metrics computed from the records rather than from workflow counters.

The v2 build makes each of these demonstrable.

## 2. Controls practice: what finance and audit will ask for

- **Ownership, risk-scaled sign-off and monitoring.** Practitioner guidance on putting agents into the close recommends documenting these before go-live. It also recommends deciding in advance what normal looks like (match rates, exception volumes, error rates found in review, time to close) and having an exit plan. ([CPA Practice Advisor](https://www.cpapracticeadvisor.com/?p=188496))
- **Rules plus agents, not agents instead of rules.** Commentary on AI reconciliation describes the agent as complementing deterministic matching rules, investigating the root of each discrepancy, and escalating only what requires judgment. Suggested KPIs include auto-match rate, unresolved exceptions, close cycle time and cost per reconciliation. ([Moveo AI](https://moveo.ai/blog/financial-reconciliation-ai-agents))

**Implications for the design:**

- Separation of duties is enforced in two layers: the RBAC matrix and a per-case check that the investigator or proposer never approves.
- Administrators hold no approval authority.
- Every accounting adjustment requires controller approval, regardless of model confidence.
- The Overview page leads with go/no-go safety gates: unauthorized writes, closures without verification, and audit-chain integrity.
- `MAX_TOOL_CALLS`, `MAX_INVESTIGATION_MS` and a planner retry budget bound the agent's work.
- The pilot measurement plan in idea-doc §9 maps directly onto data the system already records: tool calls, timestamps per state, proposals, rejections and denials.

## 3. Security: LLM-specific risks

The OWASP Top 10 for LLM Applications 2025 lists **LLM01 Prompt Injection** and **LLM06 Excessive Agency**. The 2025 edition expanded Excessive Agency because of agentic architectures, and indirect injection — instructions hidden in retrieved documents — is the harder variant. ([Modulos summary](https://docs.modulos.ai/frameworks/owasp-top-10-llm), [Open Source Security](https://opensourcesecurity.substack.com/p/a-deep-dive-into-the-owasp-top-10)) Practitioner write-ups note that telling the model in its system prompt to ignore injection attempts does not reliably work. ([DEV Community](https://dev.to/amasen/owasp-llm-top-10-what-every-engineer-building-with-ai-needs-to-know-in-2025-2gp8))

**Implications.** The boundary is architectural, exactly as idea-doc §7 states.

- **What the model can call.** It receives only five read tools. Write and compute tools exist, but the gateway refuses them to the "agent" caller class, and names outside the allowlist (`payment.release`, `db.query`, …) are denied and logged.
- **What it can read.** Tool arguments and record IDs from the model are untrusted. They are schema-validated and scope-checked, so the agent can only read records linked to the case by evidence it has already retrieved.
- **Injection handling.** Retrieved text is wrapped as `<untrusted_evidence>` (defence in depth) and screened for instruction patterns. A hit raises a visible flag — the screen is a detector, not the boundary.
- **Testing the boundary.** The PROMPT_INJECTION scenario includes a *simulated compromised planner* that obeys the injected text. The gateway denies its `payment.release` call, which proves the boundary doesn't depend on model behaviour.
- **Redaction.** Account numbers are masked before reaching the model or the logs.

## 4. Technology choices verified

- **OpenAI Responses API structured outputs.** These are configured via `text.format` with `type: "json_schema"`, and strict mode requires every property to be listed as required and `additionalProperties: false`. ([Microsoft Learn](https://learn.microsoft.com/en-ca/Azure/foundry/openai/how-to/structured-outputs), [Vercel AI Gateway docs](https://vercel.com/docs/ai-gateway/sdks-and-apis/responses/structured-outputs)) I confirmed the installed SDK (openai v7) exposes `responses.create` and `output_text`. The planner's schemas follow strict-mode rules, and tool arguments are passed as a JSON string so the schema stays strict while still being validated by the gateway.
- **MCP TypeScript SDK.** Current guidance is `McpServer.registerTool` with Zod input schemas over `StdioServerTransport` (SDK v1.x). ([Playcode guide](https://playcode.io/blog/how-to-build-an-mcp-server)) The installed version is 1.32.1. The MCP server was tested with a real MCP client over stdio.
- **Dependencies.** npm resolved TypeScript 7 by default; it was pinned to 5.9 for compatibility with Next.js 15's build-time type checking.
- **Native module risk.** A fresh-clone install check showed that, with a lockfile present, `npm ci` and `npm install` attempt to compile `better-sqlite3` 13.0.3 from source, even though it bundles prebuilt binaries. That would block teammates without build tools. Storage was moved to Node's built-in `node:sqlite` (Node 22.13+). After the move, a fresh clone installs, tests, typechecks and builds with plain `npm ci`.

## 5. Accounting treatment for the demo scenario

Under "2/10, net 30" style terms, the buyer may take a 2% discount if it pays within 10 days. Under the **gross method** the payable is recorded at the full amount, and when the discount is taken the entry is: Dr Accounts Payable (full amount), Cr Cash (amount paid), Cr Purchase Discounts (the discount). ([SuperfastCPA](https://www.superfastcpa.com/?p=48834), [Wafeq](https://www.wafeq.com/en/learn-accounting/accounting-basics/earned-discount)) Guidance also stresses that a discount should only be recognized when its conditions are actually met. ([Wafeq](https://www.wafeq.com/en/learn-accounting/accounting-basics/earned-discount))

**Implications for the build:**

- **The adjustment.** For B-104/INV-204, cash of INR 98,000 is already applied, so the proposed mock adjustment is Dr 2100 Accounts Payable INR 2,000 / Cr 4910 Purchase Discounts Received INR 2,000, plus the payment match.
- **Eligibility.** Rule R09 (settled within window) and R08 (finance-approved term) together implement "only when conditions are met".
- **Simplifications.** The window is inclusive of day 10, measured from invoice date to bank value date. Taxes and fees are excluded from the base, as the idea doc specifies. These treatments must be confirmed by the pilot's finance owner, and they are isolated in versioned rule code so they can change through reviewed commits.

## 6. Gaps found in the v1 prototype (summary)

| Area | v1 behaviour | Risk |
|---|---|---|
| Authentication | Any non-empty email/password accepted | No identity, no SoD possible |
| Data API | `/api/data` returned the entire DB, unauthenticated | Data exposure |
| Workflow | One endpoint set status strings on request | No real investigation, approval or verification |
| Controls display | "PASS" and "Sufficient" badges hardcoded | Misrepresents control state to judges/controllers |
| Approval | Anyone could approve; not bound to anything | Unauthorized and stale approvals |
| Audit | Mutable JSON list, ID `AUD-${Date.now()}` | Collisions, no tamper evidence |
| Money | JS floating-point numbers | Rounding errors in financial amounts |
| CORS | Preflight not handled | Browser requests could fail |
| Tests | None | Nothing proves the controls hold |

Each item is addressed in v2; see `SPEC.md`.
