import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, asha, karan, ravi, meera, dev, nisha, caseFor, count } from './helpers';
import { investigateCase } from '../src/workflow/investigate';
import { decideProposal } from '../src/workflow/approvals';
import { executeProposal } from '../src/workflow/execute';
import { assignCase, claimCase, addNote } from '../src/workflow/cases';
import { getCaseDetail, listAudit, exportCaseAudit } from '../src/workflow/queries';
import { listUsers, updateUser } from '../src/workflow/users';
import { investigateQueue } from '../src/workflow/automation';
import { PERMISSIONS, can } from '../src/security/rbac';
import { getDb } from '../src/db';

const code = (c: string) => expect.objectContaining({ code: c });

describe('role matrix (v3)', () => {
  beforeEach(() => { freshDb(); });

  it('keeps financial authority separated across the four roles', () => {
    expect(PERMISSIONS['approval:decide']).toEqual(['CONTROLLER']);
    expect(PERMISSIONS['case:investigate']).toEqual(['ANALYST']);
    for (const p of ['approval:decide', 'case:investigate', 'execution:trigger', 'ingest:statement'] as const) {
      expect(can(dev(), p)).toBe(false);
      expect(can(nisha(), p)).toBe(false);
    }
    expect(can(nisha(), 'audit:export')).toBe(true);
    expect(can(asha(), 'audit:read')).toBe(false);
  });

  it('auditor is strictly read-only but can see and export everything in scope', async () => {
    const id = caseFor('HAPPY_PATH');
    await expect(investigateCase(id, nisha())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const inv = await investigateCase(id, asha());
    expect(() => decideProposal(id, inv.proposalId!, 'APPROVED', 'ok', nisha())).toThrow(code('FORBIDDEN'));
    expect(() => executeProposal(id, inv.proposalId!, nisha())).toThrow(code('FORBIDDEN'));
    expect(() => assignCase(id, 'U-KARAN', nisha())).toThrow(code('FORBIDDEN'));
    expect(getCaseDetail(nisha(), id).viewer).toMatchObject({ canApprove: false, canExecute: false, canInvestigate: false, canExportAudit: true });
    expect(exportCaseAudit(nisha(), id).chainVerification.valid).toBe(true);
    expect(listAudit(nisha()).events.length).toBeGreaterThan(0);
  });
});

describe('delegation of authority', () => {
  beforeEach(() => { freshDb(); });

  it('refuses approval above the controller limit and allows a higher-limit controller', async () => {
    const id = caseFor('HIGH_VALUE');
    const inv = await investigateCase(id, asha());
    expect(getCaseDetail(ravi(), id).viewer).toMatchObject({ canApprove: false, canReject: true });
    expect(getCaseDetail(ravi(), id).viewer.approveBlockedReason).toMatch(/exceeds your approval limit/);
    expect(() => decideProposal(id, inv.proposalId!, 'APPROVED', 'ok', ravi())).toThrow(code('APPROVAL_LIMIT_EXCEEDED'));
    expect(count(getDb(), "SELECT COUNT(*) AS n FROM denied_actions WHERE reason_code='APPROVAL_LIMIT_EXCEEDED'")).toBe(1);
    decideProposal(id, inv.proposalId!, 'APPROVED', 'Within CFO-office authority', meera());
    expect(executeProposal(id, inv.proposalId!, asha()).status).toBe('CLOSED');
  });

  it('blocks execution when the approver loses authority after approving', async () => {
    const id = caseFor('HAPPY_PATH');
    const inv = await investigateCase(id, asha());
    decideProposal(id, inv.proposalId!, 'APPROVED', 'ok', ravi());
    updateUser(dev(), 'U-RAVI', { approvalLimitMinor: 1_000_00 });
    expect(() => executeProposal(id, inv.proposalId!, asha())).toThrow(code('APPROVER_AUTHORITY_REVOKED'));
    expect(getCaseDetail(asha(), id).case.status).toBe('NEEDS_REVIEW');
    expect(count(getDb(), 'SELECT COUNT(*) AS n FROM ledger_journals')).toBe(0);
  });
});

describe('case ownership', () => {
  beforeEach(() => { freshDb(); });

  it('investigation claims the case; another analyst is refused until a controller reassigns', async () => {
    const id = caseFor('MISSING_CLAUSE');
    await investigateCase(id, asha());
    expect(getCaseDetail(asha(), id).case.assigned_to).toBe('U-ASHA');
    await expect(investigateCase(id, karan())).rejects.toMatchObject({ code: 'CASE_ASSIGNED_TO_OTHER' });
    expect(() => claimCase(id, karan())).toThrow(code('CASE_ASSIGNED_TO_OTHER'));
    expect(() => assignCase(id, 'U-KARAN', asha())).toThrow(code('FORBIDDEN'));
    assignCase(id, 'U-KARAN', ravi());
    const r = await investigateCase(id, karan());
    expect(r.status).toBe('NEEDS_REVIEW');
  });

  it('only active analysts with entity access can be assignees', () => {
    const id = caseFor('HAPPY_PATH');
    expect(() => assignCase(id, 'U-MEERA', ravi())).toThrow(code('INVALID_ASSIGNEE'));
    expect(() => assignCase(id, 'U-LIM', ravi())).toThrow(code('INVALID_ASSIGNEE'));
  });

  it('notes are audited and blocked for administrators', () => {
    const id = caseFor('HAPPY_PATH');
    addNote(id, 'Vendor confirmed discount by e-mail', asha());
    expect(() => addNote(id, 'hello', dev())).toThrow(code('FORBIDDEN'));
    expect(getCaseDetail(ravi(), id).notes).toHaveLength(1);
  });

  it('batch automation investigates only the analyst\'s own or unowned open cases', async () => {
    assignCase(caseFor('LATE_PAYMENT'), 'U-KARAN', ravi());
    const r = await investigateQueue(asha());
    expect(r.results.map((x) => x.caseId)).not.toContain(caseFor('LATE_PAYMENT'));
    expect(r.investigated).toBe(9);
    expect(r.proposals).toBeGreaterThanOrEqual(4);
    await expect(investigateQueue(ravi())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('user administration', () => {
  beforeEach(() => { freshDb(); });

  it('admins cannot self-modify, cannot give limits to non-controllers, and keep one admin', () => {
    expect(() => updateUser(dev(), 'U-DEV', { role: 'CONTROLLER' })).toThrow(code('SELF_MODIFICATION'));
    expect(() => updateUser(dev(), 'U-ASHA', { approvalLimitMinor: 1_00 })).toThrow(code('SOD_APPROVAL_LIMIT'));
    expect(() => updateUser(ravi(), 'U-ASHA', { active: false })).toThrow(code('FORBIDDEN'));
    expect(listUsers(dev()).find((u) => u.id === 'U-RAVI')?.approval_limit_minor).toBe(5_000_00);
  });

  it('demoting a controller to analyst clears the limit; deactivation releases assignments', async () => {
    updateUser(dev(), 'U-RAVI', { role: 'ANALYST' });
    expect(listUsers(dev()).find((u) => u.id === 'U-RAVI')?.approval_limit_minor).toBe(0);
    await investigateCase(caseFor('LATE_PAYMENT'), karan());
    const r = updateUser(dev(), 'U-KARAN', { active: false });
    expect(r.releasedCases).toBe(1);
    expect(getCaseDetail(asha(), caseFor('LATE_PAYMENT')).case.assigned_to).toBeNull();
  });
});
