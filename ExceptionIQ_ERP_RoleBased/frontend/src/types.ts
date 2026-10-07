export type Role = 'ANALYST' | 'CONTROLLER' | 'ADMIN' | 'AUDITOR';
export type CaseStatus = 'OPEN' | 'INVESTIGATING' | 'AWAITING_APPROVAL' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'NEEDS_REVIEW' | 'BLOCKED';
export interface User { id: string; name: string; role: Role; entityIds: string[]; email?: string; approvalLimitMinor?: number; title?: string }
export interface AiStatus { enabled: boolean; model: string | null; planner: 'openai' | 'scripted'; keyConfigured: boolean; reason: string }
export interface RoleProfile { label: string; mandate: string; cannot: string[] }
export interface Session { user: User; permissions: string[]; profile: RoleProfile; ai: AiStatus }

export interface Briefing {
  headline: string; assessment: string; risk_level: 'LOW' | 'MEDIUM' | 'HIGH'; key_points: string[]; recommended_actions: string[]; watch_outs: string[];
  engine: 'openai' | 'rules'; model: string | null; role: string; generatedAt: string; fallbackReason?: string; disclaimer: string;
}
export interface Viewer {
  role: Role; approvalLimitMinor: number; isAssignee: boolean; isProposer: boolean;
  canInvestigate: boolean; investigateBlockedReason: string | null; canClaim: boolean; canAssign: boolean;
  canApprove: boolean; canReject: boolean; approveBlockedReason: string | null; canExecute: boolean; canAttemptUnapprovedWrite: boolean;
  canComment: boolean; canExportAudit: boolean; canUseAi: boolean;
}
export interface Note { id: string; author_id: string; author_name: string; author_role: string; body: string; created_at: string }

export interface CaseSummary {
  id: string; entity_id: string; scenario: string; scenarioTitle: string; title: string; status: CaseStatus; bank_txn_id: string;
  paid_minor: number; currency: string; vendor_name: string; value_date: string; residual_minor: number | null; risk_class: string | null;
  status_reason: string | null; open_proposal_id: string | null; updated_at: string; faults: { write_fail?: boolean; verify_fail?: boolean };
  assigned_to: string | null; assigned_to_name: string | null; source: string; exception_type: string | null; proposal_amount_minor: number | null;
}

export interface GraphNode { id: string; type: string; label: string; ref_id: string | null; source_table: string | null; source_version: number | null;
  content_hash: string | null; tool_call_id: string | null; status: string | null; data: Record<string, unknown>; created_at: string }
export interface GraphEdge { id: string; from_id: string; to_id: string; type: string }
export interface ToolCall { id: string; run_no: number; seq: number; tool: string; actor: string; args: Record<string, unknown>; rationale: string;
  decision: 'ALLOWED' | 'DENIED' | 'ERROR'; deny_reason: string | null; result_summary: string | null; source_refs: { table: string; id: string; version: number; hash: string }[];
  duration_ms: number; created_at: string }
export interface Hypothesis { code: string; title: string; status: string; supportingEvidence: string; rejectingEvidence: string; note?: string }
export interface RuleResult { ruleId: string; name: string; version: string; outcome: string; detail: string; sources: string[]; facts: Record<string, unknown> }
export interface JournalLine { account: string; name: string; debit_minor: number; credit_minor: number }
export interface Proposal { id: string; run_no: number; action: string; status: string; payload_hash: string; evidence_hash: string; policy_version: string;
  risk_class: string; proposed_by: string; proposed_by_name: string; created_at: string;
  evidence_manifest: { table: string; id: string; version: number; hash: string }[];
  payload: { action: string; currency: string; bank_txn_id: string; invoice_id: string; open_item_id: string; discount_minor: number; match_amount_minor: number;
    expected_residual_after_minor: number; journal: { memo: string; lines: JournalLine[] }; before: { open_item_residual_minor: number; open_item_status: string } } }
export interface Approval { id: string; proposal_id: string; approver_id: string; approver_name: string; decision: string; reason: string | null;
  payload_hash: string; evidence_hash: string; policy_version: string; decided_at: string; expires_at: string }
export interface Execution { id: string; proposal_id: string; status: string; idempotency_key: string; error: string | null; triggered_by: string; started_at: string;
  before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }
export interface Verification { id: string; execution_id: string; passed: number; guidance: string | null; created_at: string;
  checks: { id: string; label: string; passed: boolean; expected: unknown; actual: unknown }[] }
export interface AuditEvent { seq: number; id: string; case_id: string | null; entity_id: string | null; actor_id: string; actor_role: string; event_type: string;
  correlation_id: string | null; summary: string; data: Record<string, unknown>; prev_hash: string; hash: string; created_at: string }
export interface Plan { id: string; run_no: number; planner: string; model: string | null; prompt_version: string; hypotheses: Hypothesis[]; rule_results: RuleResult[];
  outcome: string | null; created_at: string; finished_at: string | null }

export interface CaseDetail {
  viewer: Viewer; notes: Note[];
  case: CaseSummary & { root_cause: string | null; explanation: string | null; investigated_by: string | null; investigated_by_name: string | null; created_at: string };
  scenario: { key: string; title: string; description: string; expected: string } | null;
  bank: { id: string; amount_minor: number; currency: string; value_date: string; counterparty_name: string; reference: string };
  latestRun: number; plans: Plan[]; toolCalls: ToolCall[]; graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  proposals: Proposal[]; approvals: Approval[]; executions: Execution[]; verifications: Verification[]; audit: AuditEvent[];
}
