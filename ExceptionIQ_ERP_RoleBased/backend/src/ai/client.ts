import OpenAI from 'openai';
import { config } from '../config';
import { redactText } from '../security/redaction';

/**
 * Shared, schema-constrained access to the OpenAI Responses API.
 * Everything the model returns is UNTRUSTED: callers validate it and it never carries authority.
 */
export interface AiClient {
  readonly model: string;
  structured<T>(name: string, schema: Record<string, unknown>, system: string, user: string): Promise<T>;
}

export class AiError extends Error {}

export interface AiStatus { enabled: boolean; model: string | null; planner: 'openai' | 'scripted'; keyConfigured: boolean; reason: string }

export function aiStatus(): AiStatus {
  const keyConfigured = !!process.env.OPENAI_API_KEY;
  const enabled = !!override || keyConfigured;
  return {
    enabled, keyConfigured, planner: config.planner, model: enabled ? config.openaiModel : null,
    reason: enabled
      ? `OpenAI model ${config.openaiModel} assists planning, clause extraction, briefings and statement parsing. Rules and people still decide.`
      : 'No OPENAI_API_KEY in backend/.env.local. Deterministic engines are used for every AI feature.',
  };
}

class OpenAiResponsesClient implements AiClient {
  private client: OpenAI;
  constructor(readonly model: string) {
    this.client = new OpenAI({ timeout: 45_000, maxRetries: 1 });
  }
  async structured<T>(name: string, schema: Record<string, unknown>, system: string, user: string): Promise<T> {
    let text: string;
    try {
      const res = await this.client.responses.create({
        model: this.model,
        input: [{ role: 'system', content: system }, { role: 'user', content: redactText(user) }],
        text: { format: { type: 'json_schema', name, schema, strict: true } },
      });
      text = res.output_text;
    } catch (e) {
      throw new AiError(`OpenAI call failed: ${(e as Error).message}`);
    }
    try { return JSON.parse(text) as T; } catch { throw new AiError('Model returned non-JSON output'); }
  }
}

let override: AiClient | null = null;
/** Tests inject a fake client; pass null to restore the real configuration. */
export function setAiClientForTesting(c: AiClient | null) { override = c; }

export function getAiClient(): AiClient | null {
  if (override) return override;
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAiResponsesClient(config.openaiModel);
}
