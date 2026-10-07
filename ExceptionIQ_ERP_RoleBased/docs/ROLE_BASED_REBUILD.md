# What changed in v3 (and why)
See `SPEC_V3.md` for the full specification.

**Crash fix.** `Catalog.tsx` used `Settings2`, `SearchCheck`, `Scale` and `Overview.tsx` used `FlaskConical` without importing them → "Settings2 is not defined". Fixed, typecheck now clean, and each screen has its own error boundary keyed by route (navigating away always recovers).
**Roles.** Added AUDITOR; granular permissions; controller approval limits; case ownership/assignment; admin user management with SoD guardrails; route guards; server-computed per-case `viewer` capabilities so the UI never offers a refused action.
**Automation.** Bank statement import with auto-match, cash application, classified exception cases, auto-investigation, sample generator, batch "investigate my queue".
**AI.** Role-aware briefings, daily briefings, AI statement parsing, admin connection test, AI status chip; all with deterministic fallbacks.
**Robustness.** Old database files are rebuilt automatically when the schema changes (`SCHEMA_VERSION`).
