import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, asha, caseFor, ravi } from './helpers';
import { getDb } from '../src/db';
import { verifyAuditChain } from '../src/audit/audit';
import { investigateCase } from '../src/workflow/investigate';
import { exportCaseAudit } from '../src/workflow/queries';

describe('append-only, hash-chained audit log', () => {
  beforeEach(() => { freshDb(); });

  it('is valid after a full investigation', async () => {
    await investigateCase(caseFor('HAPPY_PATH'), asha());
    expect(verifyAuditChain(getDb()).valid).toBe(true);
  });
  it('rejects UPDATE and DELETE at the database layer', () => {
    const db = getDb();
    expect(() => db.prepare("UPDATE audit_events SET summary='x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/);
  });
  it('detects tampering even by someone who bypasses the triggers', async () => {
    await investigateCase(caseFor('HAPPY_PATH'), asha());
    const db = getDb();
    db.exec('DROP TRIGGER audit_no_update');
    db.prepare("UPDATE audit_events SET summary='nothing happened' WHERE seq=5").run();
    const v = verifyAuditChain(db);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSeq).toBe(5);
  });
  it('exports a reproducible case bundle with chain verification', async () => {
    const id = caseFor('HAPPY_PATH');
    await investigateCase(id, asha());
    expect(() => exportCaseAudit(asha(), id)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    const x = exportCaseAudit(ravi(), id);
    expect(x.chainVerification.valid).toBe(true);
    expect(x.audit.length).toBeGreaterThan(5);
    expect(x.graph.nodes.length).toBeGreaterThan(5);
    expect(x.notice).toMatch(/no private model reasoning/);
  });
});
