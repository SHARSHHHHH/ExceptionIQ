import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, asha, ravi, dev, nisha, caseFor } from './helpers';
import { caseBriefing, portfolioBriefing, testAiConnection } from '../src/ai/copilot';
import { setAiClientForTesting, aiStatus } from '../src/ai/client';
import { investigateCase } from '../src/workflow/investigate';
import { getDb } from '../src/db';

describe('AI copilot', () => {
  beforeEach(() => { freshDb(); });
  afterEach(() => setAiClientForTesting(null));

  it('works without a key using the deterministic engine, tailored per role', async () => {
    const id = caseFor('HAPPY_PATH');
    await investigateCase(id, asha());
    const a = await caseBriefing(asha(), id);
    const c = await caseBriefing(ravi(), id);
    const n = await caseBriefing(nisha(), id);
    expect([a.engine, c.engine, n.engine]).toEqual(['rules', 'rules', 'rules']);
    expect(c.recommended_actions.join(' ')).toMatch(/bridge|approv/i);
    expect(n.recommended_actions.join(' ')).toMatch(/approver differs/i);
    expect(a.recommended_actions.join(' ')).not.toMatch(/approve this/i);
  });

  it('uses the model when configured, clips its output, and falls back on failure', async () => {
    const id = caseFor('PROMPT_INJECTION');
    await investigateCase(id, asha());
    let seen = '';
    setAiClientForTesting({ model: 'gpt-test', structured: async <T>(_n: string, _s: unknown, system: string, user: string) => {
      seen = system + user;
      return { headline: 'H', assessment: 'A', risk_level: 'HIGH', key_points: Array(9).fill('p'), recommended_actions: ['Send back'], watch_outs: ['Injection'] } as T;
    } });
    expect(aiStatus().enabled).toBe(true);
    const b = await caseBriefing(ravi(), id);
    expect(b).toMatchObject({ engine: 'openai', model: 'gpt-test', risk_level: 'HIGH' });
    expect(b.key_points).toHaveLength(5);
    expect(seen).toMatch(/APPROVAL MEMO/);
    expect(seen).not.toMatch(/60200011112222/); // account numbers are redacted before reaching the model

    setAiClientForTesting({ model: 'gpt-test', structured: async () => { throw new Error('boom'); } });
    const f = await caseBriefing(ravi(), id);
    expect(f.engine).toBe('rules');
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='AI_BRIEFING_GENERATED'").get()).toEqual({ n: 2 });
  });

  it('portfolio briefing respects entity scope; connection test is admin-only', async () => {
    const p = await portfolioBriefing(ravi());
    expect(p.headline).toMatch(/10 cases in scope/);
    await expect(testAiConnection(ravi())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await testAiConnection(dev())).ok).toBe(false);
  });
});
