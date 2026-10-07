import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, asha, caseFor } from './helpers';
import { OpenAIPlanner, ResponsesClient } from '../src/agent/openaiPlanner';
import { setPlannerForTesting } from '../src/agent';
import { investigateCase } from '../src/workflow/investigate';
import { getCaseDetail } from '../src/workflow/queries';

/**
 * Fake Responses API client: answers by schema name, records every request body.
 * Lets us test prompt construction, strict-schema parsing and failure handling without network access.
 */
function fakeClient(script: Record<string, (body: Record<string, unknown>) => unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client: ResponsesClient = {
    responses: {
      async create(body) {
        calls.push(body);
        const name = ((body.text as { format: { name: string } }).format.name);
        const out = script[name](body);
        if (out instanceof Error) throw out;
        return { output_text: typeof out === 'string' ? out : JSON.stringify(out) };
      },
    },
  };
  return { client, calls };
}

const happySteps = [
  { action: 'call_tool', tool: 'bank.get_transaction', args_json: '{"transaction_id":"B-104"}', rationale: 'start' },
  { action: 'call_tool', tool: 'erp.get_open_items', args_json: '{"vendor_id":"V-17","include_cleared":true,"limit":10}', rationale: 'items' },
  { action: 'call_tool', tool: 'invoice.get_with_po', args_json: '{"invoice_id":"INV-204"}', rationale: 'invoice' },
  { action: 'call_tool', tool: 'vendor.get_verified_identity', args_json: '{"vendor_id":"V-17"}', rationale: 'identity' },
  { action: 'call_tool', tool: 'contract.get_effective_terms', args_json: '{"vendor_id":"V-17","as_of_date":"2026-09-01"}', rationale: 'terms' },
  { action: 'finish', tool: 'none', args_json: '{}', rationale: 'done' },
];
const goodClause = { found: true, rate_percent_text: '2', window_days: 10, quoted_sentence: 'Where the Buyer settles an undisputed invoice within 10 (ten) calendar days' };

describe('OpenAI planner (strict structured outputs)', () => {
  beforeEach(() => { freshDb(); });

  it('drives the happy path; requests use json_schema strict mode; evidence is wrapped as untrusted', async () => {
    const steps = [...happySteps];
    const { client, calls } = fakeClient({
      hypotheses: () => ({ ranked_codes: ['EARLY_PAYMENT_DISCOUNT', 'BANK_FEE'], note: '' }),
      next_step: () => steps.shift(),
      clause: () => goodClause,
      explanation: () => ({ explanation: 'Discount explains the residual.' }),
    });
    setPlannerForTesting(new OpenAIPlanner('test-model', client));
    const res = await investigateCase(caseFor('HAPPY_PATH'), asha());
    expect(res.status).toBe('AWAITING_APPROVAL');
    const fmt = (calls[0].text as { format: { type: string; strict: boolean } }).format;
    expect(fmt).toMatchObject({ type: 'json_schema', strict: true });
    const later = JSON.stringify(calls[3]);
    expect(later).toContain('<untrusted_evidence>');
    expect(later).not.toContain('50100023454821'); // vendor account never sent in clear
    const d = getCaseDetail(asha(), caseFor('HAPPY_PATH'));
    expect(d.plans[0]).toMatchObject({ planner: 'openai', model: 'test-model', prompt_version: 'planner-v1.3' });
    expect(d.case.explanation).toBe('Discount explains the residual.');
  });

  it('a hallucinated clause quote is discarded; a contradicting model clause forces review', async () => {
    const steps = [...happySteps];
    const { client } = fakeClient({
      hypotheses: () => ({ ranked_codes: [], note: '' }), next_step: () => steps.shift(),
      clause: () => ({ found: true, rate_percent_text: '5', window_days: 30, quoted_sentence: 'Where the Buyer settles an undisputed invoice within 10 (ten) calendar days' }),
      explanation: () => ({ explanation: 'x' }),
    });
    setPlannerForTesting(new OpenAIPlanner('m', client));
    const res = await investigateCase(caseFor('HAPPY_PATH'), asha());
    expect(res.status).toBe('NEEDS_REVIEW'); // model said 5%/30d, deterministic extractor says 2%/10d
  });

  it('model tool choices remain untrusted: an out-of-scope request is denied by the gateway', async () => {
    const steps = [{ action: 'call_tool', tool: 'bank.get_transaction', args_json: '{"transaction_id":"B-962"}', rationale: 'peek' }, happySteps[5]];
    const { client } = fakeClient({ hypotheses: () => ({ ranked_codes: [], note: '' }), next_step: () => steps.shift(), clause: () => goodClause, explanation: () => ({ explanation: 'x' }) });
    setPlannerForTesting(new OpenAIPlanner('m', client));
    const res = await investigateCase(caseFor('HAPPY_PATH'), asha());
    expect(res.status).toBe('NEEDS_REVIEW');
    expect(getCaseDetail(asha(), caseFor('HAPPY_PATH')).toolCalls[0]).toMatchObject({ decision: 'DENIED', deny_reason: expect.stringContaining('not bound') });
  });

  it('repeated model failures exhaust the retry budget and return the case to review', async () => {
    const { client } = fakeClient({ hypotheses: () => new Error('503'), next_step: () => new Error('timeout'), clause: () => goodClause, explanation: () => new Error('503') });
    setPlannerForTesting(new OpenAIPlanner('m', client));
    const res = await investigateCase(caseFor('HAPPY_PATH'), asha());
    expect(res.status).toBe('NEEDS_REVIEW');
    const d = getCaseDetail(asha(), caseFor('HAPPY_PATH'));
    expect(d.audit.filter((a) => a.event_type === 'PLANNER_ERROR').length).toBeGreaterThanOrEqual(3);
  });

  it('malformed model output is rejected, never executed', async () => {
    const { client } = fakeClient({ hypotheses: () => ({ ranked_codes: [], note: '' }), next_step: () => 'not json', clause: () => goodClause, explanation: () => ({ explanation: 'x' }) });
    setPlannerForTesting(new OpenAIPlanner('m', client));
    const res = await investigateCase(caseFor('HAPPY_PATH'), asha());
    expect(res.status).toBe('NEEDS_REVIEW');
    expect(res.toolCalls).toBe(0);
  });
});
