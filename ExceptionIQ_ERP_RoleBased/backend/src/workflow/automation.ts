import { getDb } from '../db';
import { Actor } from '../domain/types';
import { requirePermission } from '../security/rbac';
import { investigateCase } from './investigate';

/**
 * Investigates the analyst's whole queue in one action: every OPEN case in their entities that is unassigned
 * or already theirs. Each case goes through the same governed run (gateway, rules, proposal); nothing is approved.
 */
export async function investigateQueue(actor: Actor, limit = 25) {
  requirePermission(actor, 'automation:batch');
  requirePermission(actor, 'case:investigate');
  const rows = getDb().prepare("SELECT id, entity_id, assigned_to FROM cases WHERE status='OPEN' ORDER BY created_at, id").all() as { id: string; entity_id: string; assigned_to: string | null }[];
  const queue = rows.filter((r) => actor.entityIds.includes(r.entity_id) && (!r.assigned_to || r.assigned_to === actor.id)).slice(0, Math.min(Math.max(limit, 1), 50));
  const results: { caseId: string; status: string; outcome: string; error?: string }[] = [];
  for (const r of queue) {
    try { const out = await investigateCase(r.id, actor); results.push({ caseId: r.id, status: out.status, outcome: out.outcome }); }
    catch (e) { results.push({ caseId: r.id, status: 'ERROR', outcome: 'ERROR', error: (e as Error).message }); }
  }
  const tally = (s: string) => results.filter((x) => x.status === s).length;
  return { investigated: results.length, proposals: tally('AWAITING_APPROVAL'), review: tally('NEEDS_REVIEW'), blocked: tally('BLOCKED'), errors: tally('ERROR'), results };
}
