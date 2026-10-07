/**
 * Headless end-to-end replay of every scenario against a fresh in-memory database.
 * Prints the outcome and measured timings. Usage: npm run demo
 */
import { createDatabase, useDatabase } from '../src/db';
import { DEMO_USERS } from '../src/fixtures/scenarios';
import { investigateCase } from '../src/workflow/investigate';
import { decideProposal } from '../src/workflow/approvals';
import { executeProposal } from '../src/workflow/execute';
import { getMetrics } from '../src/workflow/queries';
import { getCaseRow } from '../src/workflow/cases';
import { Actor } from '../src/domain/types';
import { SCENARIOS } from '../src/fixtures/scenarios';

const db = useDatabase(createDatabase(':memory:'));
const actor = (id: string): Actor => { const u = DEMO_USERS.find((x) => x.id === id)!; return { id: u.id, name: u.name, role: u.role, entityIds: [...u.entityIds], approvalLimitMinor: u.approvalLimitMinor, title: u.title }; };
const analyst = { IN01: actor('U-ASHA'), SG01: actor('U-LIM') } as Record<string, Actor>;
const controller = { IN01: actor('U-RAVI'), SG01: actor('U-TAN') } as Record<string, Actor>;

const rows: Record<string, string | number>[] = [];
for (const s of SCENARIOS) {
  const caseId = `CASE-${s.ids.bank.replace('B-', '')}`;
  const t0 = performance.now();
  const inv = await investigateCase(caseId, analyst[s.entityId]);
  const tInv = performance.now() - t0;
  let final = inv.status as string; let note = '';
  if (inv.proposalId) {
    try { executeProposal(caseId, inv.proposalId, analyst[s.entityId]); } catch (e) { note += `unapproved write blocked (${(e as { code: string }).code}); `; }
    const approver = s.key === 'HIGH_VALUE' ? actor('U-MEERA') : controller[s.entityId];
    if (s.key === 'HIGH_VALUE') { try { decideProposal(caseId, inv.proposalId, 'APPROVED', 'x', controller[s.entityId]); } catch (e) { note += `Ravi refused (${(e as { code: string }).code}); `; } }
    decideProposal(caseId, inv.proposalId, 'APPROVED', 'Evidence and rule results reviewed', approver);
    const ex = executeProposal(caseId, inv.proposalId, analyst[s.entityId]);
    final = ex.status;
    try {
      if (executeProposal(caseId, inv.proposalId, analyst[s.entityId]).replayed) note += 'retry idempotent; ';
    } catch (e) { note += `retry refused (${(e as { code: string }).code}); `; }
  }
  rows.push({ scenario: s.key, toolCalls: inv.toolCalls, outcome: inv.outcome, final: getCaseRow(db, caseId)!.status, ms: Math.round(performance.now() - t0), investigateMs: Math.round(tInv), note: (note + (getCaseRow(db, caseId)!.status_reason ?? '')).slice(0, 90) });
}
console.table(rows);
const m = getMetrics(actor('U-DEV'));
console.log('Safety:', JSON.stringify(m.safety), '\nDenied:', JSON.stringify(m.denied));
