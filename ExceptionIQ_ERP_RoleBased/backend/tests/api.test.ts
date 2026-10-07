import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers';
import { POST as login } from '../app/api/auth/login/route';
import { GET as me } from '../app/api/auth/me/route';
import { GET as listCases } from '../app/api/cases/route';
import { GET as getCase } from '../app/api/cases/[id]/route';
import { POST as investigate } from '../app/api/cases/[id]/investigate/route';
import { POST as decide } from '../app/api/cases/[id]/decision/route';
import { POST as execute } from '../app/api/cases/[id]/execute/route';
import { GET as exportCase } from '../app/api/cases/[id]/export/route';
import { GET as metrics } from '../app/api/metrics/route';
import { GET as catalog } from '../app/api/catalog/route';
import { DEMO_PASSWORD } from '../src/fixtures/scenarios';

const req = (method: string, token?: string, body?: unknown) => new Request('http://local/api', {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const np = { params: Promise.resolve({}) };
const p = (id: string) => ({ params: Promise.resolve({ id }) });
async function tokenFor(email: string) {
  const r = await login(req('POST', undefined, { email, password: DEMO_PASSWORD }));
  expect(r.status).toBe(200);
  return ((await r.json()) as { token: string }).token;
}

describe('HTTP API', () => {
  beforeEach(() => { freshDb(); });

  it('rejects bad credentials and missing/forged tokens', async () => {
    expect((await login(req('POST', undefined, { email: 'asha.analyst@exceptioniq.demo', password: 'wrong' }))).status).toBe(401);
    expect((await listCases(req('GET'), np)).status).toBe(401);
    expect((await listCases(req('GET', 'eyJzdWIiOiJVLVJBVkkiLCJleHAiOjk5OTk5OTk5OTk5OTl9.forged'), np)).status).toBe(401);
  });

  it('runs the governed flow end-to-end over HTTP with role checks', async () => {
    const analyst = await tokenFor('asha.analyst@exceptioniq.demo');
    const controller = await tokenFor('ravi.controller@exceptioniq.demo');
    const meBody = await (await me(req('GET', analyst), np)).json() as { permissions: string[] };
    expect(meBody.permissions).not.toContain('approval:decide');

    const cases = await (await listCases(req('GET', analyst), np)).json() as { cases: { id: string }[] };
    expect(cases.cases.length).toBe(10); // SG01 case hidden

    const inv = await (await investigate(req('POST', analyst), p('CASE-104'))).json() as { proposalId: string; status: string };
    expect(inv.status).toBe('AWAITING_APPROVAL');

    const early = await execute(req('POST', analyst, { proposalId: inv.proposalId }), p('CASE-104'));
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe('NOT_APPROVED');

    expect((await decide(req('POST', analyst, { proposalId: inv.proposalId, decision: 'APPROVED' }), p('CASE-104'))).status).toBe(403);
    expect((await decide(req('POST', controller, { proposalId: inv.proposalId, decision: 'MAYBE' }), p('CASE-104'))).status).toBe(400);
    expect((await decide(req('POST', controller, { proposalId: inv.proposalId, decision: 'APPROVED', reason: 'ok' }), p('CASE-104'))).status).toBe(200);

    const ex = await (await execute(req('POST', controller, { proposalId: inv.proposalId }), p('CASE-104'))).json() as { status: string };
    expect(ex.status).toBe('CLOSED');

    const detail = await (await getCase(req('GET', analyst), p('CASE-104'))).json() as { case: { status: string } };
    expect(detail.case.status).toBe('CLOSED');
    const exp = await (await exportCase(req('GET', controller), p('CASE-104'))).json() as { chainVerification: { valid: boolean } };
    expect(exp.chainVerification.valid).toBe(true);
    const m = await (await metrics(req('GET', controller), np)).json() as { safety: { unauthorizedWrites: number } };
    expect(m.safety.unauthorizedWrites).toBe(0);
  });

  it('returns 404 for cross-entity access and never leaks internals', async () => {
    const analyst = await tokenFor('asha.analyst@exceptioniq.demo');
    const r = await getCase(req('GET', analyst), p('CASE-S01'));
    expect(r.status).toBe(404);
    const body = JSON.stringify(await r.json());
    expect(body).not.toMatch(/SG01|stack|sqlite/i);
  });

  it('rejects unknown body fields (strict schemas)', async () => {
    const controller = await tokenFor('ravi.controller@exceptioniq.demo');
    const r = await decide(req('POST', controller, { proposalId: 'X', decision: 'APPROVED', approver_id: 'U-ASHA' }), p('CASE-104'));
    expect(r.status).toBe(400);
  });

  it('serves the catalog without exposing tool input internals', async () => {
    const t = await tokenFor('dev.admin@exceptioniq.demo');
    const c = await (await catalog(req('GET', t), np)).json() as { tools: Record<string, unknown>[]; rules: unknown[]; scenarios: unknown[] };
    expect(c.rules).toHaveLength(10);
    expect(c.scenarios).toHaveLength(11);
    expect(c.tools.every((x) => !('input' in x))).toBe(true);
  });
});
