/**
 * Relational schema. Source-system tables (bank_, erp_, invoices, ...) are MOCK enterprise systems.
 * Every source row carries a `version` that increments on change; evidence binds to (id, version, hash).
 * audit_events is append-only: UPDATE and DELETE are rejected by triggers.
 */
/** Bump whenever the schema changes. A demo database with a different version is rebuilt automatically. */
export const SCHEMA_VERSION = 3;

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_currency TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ANALYST','CONTROLLER','ADMIN','AUDITOR')),
  entity_ids TEXT NOT NULL, password_hash TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  -- Delegation of authority: the largest adjustment (minor units) this controller may approve. 0 = no authority.
  approval_limit_minor INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT
);

-- ===== Mock enterprise source systems =====
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), name TEXT NOT NULL,
  beneficiary_ref TEXT NOT NULL, beneficiary_fingerprint TEXT NOT NULL, verified INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL, value_date TEXT NOT NULL, beneficiary_fingerprint TEXT NOT NULL,
  counterparty_name TEXT NOT NULL, reference TEXT NOT NULL, vendor_hint TEXT,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, vendor_id TEXT NOT NULL, amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, vendor_id TEXT NOT NULL, effective_from TEXT NOT NULL,
  effective_to TEXT, clause_text TEXT NOT NULL,
  approved_terms TEXT, -- finance-approved structured terms (JSON) or NULL when none were approved
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, vendor_id TEXT NOT NULL, po_id TEXT, contract_id TEXT,
  invoice_date TEXT NOT NULL, amount_minor INTEGER NOT NULL, discount_base_minor INTEGER NOT NULL,
  currency TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS erp_open_items (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, invoice_id TEXT NOT NULL, vendor_id TEXT NOT NULL,
  expected_minor INTEGER NOT NULL, settled_minor INTEGER NOT NULL, residual_minor INTEGER NOT NULL,
  currency TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('OPEN','CLEARED')),
  discount_adjusted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_matches (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, bank_txn_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, execution_id TEXT, created_at TEXT NOT NULL,
  UNIQUE (bank_txn_id)
);
CREATE TABLE IF NOT EXISTS ledger_journals (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, execution_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
  lines TEXT NOT NULL, memo TEXT NOT NULL, created_at TEXT NOT NULL
);

-- ===== ExceptionIQ case management =====
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), scenario TEXT NOT NULL,
  source_event_key TEXT UNIQUE NOT NULL, bank_txn_id TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL, risk_class TEXT, residual_minor INTEGER, currency TEXT,
  root_cause TEXT, explanation TEXT, status_reason TEXT, faults TEXT NOT NULL DEFAULT '{}',
  investigated_by TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  assigned_to TEXT, source TEXT NOT NULL DEFAULT 'SEEDED', exception_type TEXT
);
CREATE TABLE IF NOT EXISTS case_notes (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), author_id TEXT NOT NULL,
  author_role TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingest_batches (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, imported_by TEXT NOT NULL, source TEXT NOT NULL,
  rows_total INTEGER NOT NULL, auto_matched INTEGER NOT NULL, cases_created INTEGER NOT NULL,
  duplicates INTEGER NOT NULL, rejected INTEGER NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auto_matches (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, batch_id TEXT NOT NULL, bank_txn_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL, open_item_id TEXT NOT NULL, amount_minor INTEGER NOT NULL, rule TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_plans (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), run_no INTEGER NOT NULL,
  planner TEXT NOT NULL, model TEXT, prompt_version TEXT NOT NULL, hypotheses TEXT NOT NULL,
  rule_results TEXT NOT NULL DEFAULT '[]', outcome TEXT, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, run_no INTEGER NOT NULL, seq INTEGER NOT NULL,
  tool TEXT NOT NULL, actor TEXT NOT NULL, args TEXT NOT NULL, rationale TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOWED','DENIED','ERROR')), deny_reason TEXT,
  result_summary TEXT, source_refs TEXT NOT NULL DEFAULT '[]', duration_ms INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, run_no INTEGER NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL,
  ref_id TEXT, source_table TEXT, source_version INTEGER, content_hash TEXT, tool_call_id TEXT,
  status TEXT, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, from_id TEXT NOT NULL REFERENCES graph_nodes(id),
  to_id TEXT NOT NULL REFERENCES graph_nodes(id), type TEXT NOT NULL
    CHECK (type IN ('supports','contradicts','derived_from','evaluated_by','authorized_by','verified_by','proposes','executes')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, run_no INTEGER NOT NULL, action TEXT NOT NULL,
  payload TEXT NOT NULL, payload_hash TEXT NOT NULL, evidence_manifest TEXT NOT NULL, evidence_hash TEXT NOT NULL,
  policy_version TEXT NOT NULL, risk_class TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','SUPERSEDED','EXECUTED','FAILED')),
  proposed_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id), case_id TEXT NOT NULL,
  approver_id TEXT NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')), reason TEXT,
  payload_hash TEXT NOT NULL, evidence_hash TEXT NOT NULL, policy_version TEXT NOT NULL,
  decided_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, case_id TEXT NOT NULL, approval_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
  before_state TEXT, after_state TEXT, error TEXT, triggered_by TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, execution_id TEXT NOT NULL, passed INTEGER NOT NULL,
  checks TEXT NOT NULL, guidance TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS denied_actions (
  id TEXT PRIMARY KEY, case_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, reason_code TEXT NOT NULL,
  reason TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, case_id TEXT, entity_id TEXT,
  actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, event_type TEXT NOT NULL, correlation_id TEXT,
  summary TEXT NOT NULL, data TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE INDEX IF NOT EXISTS idx_tool_calls_case ON tool_calls(case_id, run_no, seq);
CREATE INDEX IF NOT EXISTS idx_nodes_case ON graph_nodes(case_id, run_no);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_id, seq);
CREATE INDEX IF NOT EXISTS idx_proposals_case ON proposals(case_id);
CREATE INDEX IF NOT EXISTS idx_notes_case ON case_notes(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_assignee ON cases(assigned_to);
`;
