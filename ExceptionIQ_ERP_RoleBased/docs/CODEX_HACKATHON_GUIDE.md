# ExceptionIQ — Codex Hackathon Explanation

## What Codex is doing
Codex is the **engineering accelerator**, not the production decision-maker. The deployed investigation agent is a separate application component that uses an OpenAI model. Codex is used to accelerate implementation and validation of the system.

## Codex-assisted engineering areas
- Backend case workflow and state-machine endpoints
- Frontend ERP workbench and role-specific screens
- MCP / controlled tool adapters and integration scaffolding
- Versioned deterministic policy and rule code
- Synthetic fixtures and unit/integration/adversarial tests
- API documentation and operational/runbook scaffolding
- Reviewable repository changes and validation outputs

## What Codex does NOT do
- It does not approve financial actions.
- It does not become a runtime shell or database authority.
- It does not change production policy by itself.
- It does not bypass RBAC, approval or evidence controls.
- It does not replace deterministic financial arithmetic.

## Runtime AI architecture
OpenAI-powered planning proposes hypotheses and next permitted evidence reads. MCP exposes narrowly scoped tools. The tool gateway validates arguments and access. Deterministic rules decide financial eligibility. A separately permissioned executor performs only an approved mock write. An independent verifier re-reads the resulting state.

## Demo story
Start with the INR 2,000 residual. Show adaptive investigation, contract discovery, deterministic 2% calculation, evidence graph, blocked unapproved write, controller approval, mock execution, independent verification and audit export. Then replay a missing-clause, duplicate, prompt-injection, rejected-approval or verification-failure scenario to show that the system escalates safely instead of guessing.

## Responsible engineering proof
- Deny-by-default permissions
- Entity/tenant boundaries
- Case-scoped least-privilege tools
- Retrieved documents treated as untrusted evidence
- Approval bound to exact payload/evidence/policy
- Idempotent execution and fresh preconditions
- Independent verification before closure
- Append-only hash-chained audit events
- Synthetic financial data and mock writes for the hackathon
