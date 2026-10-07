import { route } from '@/src/http/handler';
import { RULE_CATALOGUE, POLICY_PACK } from '@/src/rules/discountPolicy';
import { TOOLS } from '@/src/tools/registry';
import { SCENARIOS } from '@/src/fixtures/scenarios';
import { PERMISSIONS, ROLE_PROFILES, can, requirePermission } from '@/src/security/rbac';
import { aiStatus } from '@/src/ai/client';
import { TRANSITIONS } from '@/src/domain/stateMachine';
import { config } from '@/src/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLICY_MATRIX = [
  { condition: 'Authorized read within case scope', behavior: 'Allow and log', enforcedBy: 'Tool gateway scope check + audit' },
  { condition: 'Missing, stale or contradictory evidence', behavior: 'Stop resolution; analyst review', enforcedBy: 'R01/R06/R08, approval & executor freshness checks' },
  { condition: 'Valid discount requiring accounting adjustment', behavior: 'Controller approval regardless of model confidence', enforcedBy: 'Proposal risk class + executor approval check' },
  { condition: 'Approval rejected, expired or payload changed', behavior: 'Block execution; new decision required', enforcedBy: 'Executor hash/expiry checks' },
  { condition: 'Duplicate match, currency conflict or unauthorized entity', behavior: 'Block and escalate', enforcedBy: 'R02/R03/R05 BLOCK; entity boundary (404)' },
  { condition: 'Payment release, bank-detail update or real financial write', behavior: 'Outside the action set', enforcedBy: 'Not in tool allowlist → TOOL_NOT_ALLOWLISTED' },
  { condition: 'Adjustment above the approver\'s delegation-of-authority limit', behavior: 'Refuse approval; route to a higher-limit controller', enforcedBy: 'Approval service + executor re-check (APPROVAL_LIMIT_EXCEEDED / APPROVER_AUTHORITY_REVOKED)' },
  { condition: 'Case owned by another analyst', behavior: 'Refuse investigation; controller reassigns', enforcedBy: 'Ownership check (CASE_ASSIGNED_TO_OTHER)' },
  { condition: 'Exact statement payment, verified beneficiary, single open item', behavior: 'Auto-match without journal (no P&L impact)', enforcedBy: 'AUTO-MATCH@1.0.0 in statement import' },
  { condition: 'Administrator changing own access, or giving a limit to a non-controller', behavior: 'Refuse and audit', enforcedBy: 'User service (SELF_MODIFICATION / SOD_APPROVAL_LIMIT)' },
];

export const GET = route(({ actor }) => {
  requirePermission(actor, 'catalog:read');
  return {
  policyPack: POLICY_PACK,
  rules: RULE_CATALOGUE,
  roles: ROLE_PROFILES,
  ai: aiStatus(),
  tools: can(actor, 'tools:read') ? Object.values(TOOLS).map(({ input: _i, ...t }) => t) : [],
  scenarios: SCENARIOS.map(({ key, title, description, expected, entityId, ids, faults }) => ({ key, title, description, expected, entityId, caseId: `CASE-${ids.bank.replace('B-', '')}`, faults: faults ?? {} })),
  permissions: PERMISSIONS,
  transitions: TRANSITIONS,
  policyMatrix: POLICY_MATRIX,
  runtime: { planner: config.planner, model: config.planner === 'openai' ? config.openaiModel : null, budgets: config.budgets, approvalTtlMinutes: config.approvalTtlMinutes },
  };
});
