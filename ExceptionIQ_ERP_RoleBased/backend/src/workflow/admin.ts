import { getDb, resetDemoDatabase } from '../db';
import { clock, config } from '../config';
import { Actor, DomainError } from '../domain/types';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../security/rbac';
import { loadCaseFor } from './cases';

export function resetDemo(actor: Actor) {
  requirePermission(actor, 'admin:reset');
  if (!config.demoMode) throw new DomainError('DISABLED', 'Reset is only available in demo mode', 403);
  const db = resetDemoDatabase();
  appendAudit(db, { actor, type: 'DEMO_RESET', summary: `Demo environment reset by ${actor.name}` });
  return { ok: true };
}

/**
 * Simulates an upstream change to a source record after a proposal/approval exists
 * (e.g. a contract amendment). Used to demonstrate that approvals bind to an evidence version.
 */
export function simulateSourceChange(actor: Actor, caseId: string) {
  requirePermission(actor, 'admin:simulate');
  if (!config.demoMode) throw new DomainError('DISABLED', 'Simulation is only available in demo mode', 403);
  const db = getDb();
  const kase = loadCaseFor(db, actor, caseId);
  const inv = db.prepare('SELECT contract_id FROM invoices i JOIN erp_open_items o ON o.invoice_id=i.id JOIN bank_transactions b ON b.vendor_hint=o.vendor_id WHERE b.id=? LIMIT 1')
    .get(kase.bank_txn_id) as { contract_id: string } | undefined;
  if (!inv) throw new DomainError('NOT_FOUND', 'No linked contract to amend', 404);
  db.prepare(`UPDATE contracts SET clause_text = clause_text || ' [Amendment A1: notice address updated]', version=version+1, updated_at=? WHERE id=?`)
    .run(clock.now().toISOString(), inv.contract_id);
  appendAudit(db, { caseId, entityId: kase.entity_id, actor, type: 'SOURCE_CHANGE_SIMULATED', summary: `Contract ${inv.contract_id} amended (version bumped) by simulation`, data: { contractId: inv.contract_id } });
  return { ok: true, contractId: inv.contract_id };
}
