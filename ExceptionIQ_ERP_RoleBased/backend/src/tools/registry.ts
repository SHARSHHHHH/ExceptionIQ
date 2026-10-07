import { z } from 'zod';

export type ToolAccess = 'READ' | 'COMPUTE' | 'WRITE';
export type ToolCaller = 'agent' | 'engine' | 'executor' | 'verifier';

export interface ToolContract {
  name: string;
  access: ToolAccess;
  description: string;
  boundary: string;
  /** Which server-side components may invoke the tool. The model ("agent") is never given WRITE tools. */
  callers: ToolCaller[];
  input: z.ZodTypeAny;
}

const id = z.string().trim().regex(/^[A-Z]{1,4}-[A-Z0-9]{1,8}$/, 'Expected a record identifier like INV-204');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The complete allowlist (idea doc §6, "Controlled tool" table). Anything else is denied. */
export const TOOLS: Record<string, ToolContract> = {
  'bank.get_transaction': {
    name: 'bank.get_transaction', access: 'READ', callers: ['agent'],
    description: 'Read the bank transaction that triggered the case.',
    boundary: 'Only the transaction bound to the authorized case.',
    input: z.object({ transaction_id: id }).strict(),
  },
  'erp.get_open_items': {
    name: 'erp.get_open_items', access: 'READ', callers: ['agent'],
    description: 'List ERP open items (and their settlement matches) for the case vendor.',
    boundary: 'Vendor linked to the case; entity filter applied server-side; max 20 results.',
    input: z.object({ vendor_id: id, include_cleared: z.boolean().default(true), limit: z.number().int().min(1).max(20).default(10) }).strict(),
  },
  'invoice.get_with_po': {
    name: 'invoice.get_with_po', access: 'READ', callers: ['agent'],
    description: 'Read an invoice and its linked purchase order.',
    boundary: 'Invoice must already be linked to the case through an ERP open item.',
    input: z.object({ invoice_id: id }).strict(),
  },
  'vendor.get_verified_identity': {
    name: 'vendor.get_verified_identity', access: 'READ', callers: ['agent'],
    description: 'Read verified vendor identity with masked beneficiary details.',
    boundary: 'Vendor linked to the case; account numbers masked; no credential retrieval.',
    input: z.object({ vendor_id: id }).strict(),
  },
  'contract.get_effective_terms': {
    name: 'contract.get_effective_terms', access: 'READ', callers: ['agent'],
    description: 'Read the contract effective for the vendor on a date, including clause text and finance-approved terms.',
    boundary: 'Vendor linked to the case; only the agreement effective on the requested date.',
    input: z.object({ vendor_id: id, as_of_date: isoDate }).strict(),
  },
  'policy.evaluate_resolution': {
    name: 'policy.evaluate_resolution', access: 'COMPUTE', callers: ['engine'],
    description: 'Run the versioned deterministic rule pack over retrieved evidence.',
    boundary: 'Pure computation; no write authority.',
    input: z.object({ case_id: z.string() }).strict(),
  },
  'resolution.apply_mock_adjustment': {
    name: 'resolution.apply_mock_adjustment', access: 'WRITE', callers: ['executor'],
    description: 'Post the approved mock discount journal and payment match.',
    boundary: 'Approved payload only; fresh preconditions; idempotency key; executor identity only.',
    input: z.object({ proposal_id: z.string() }).strict(),
  },
  'resolution.verify': {
    name: 'resolution.verify', access: 'READ', callers: ['verifier'],
    description: 'Independently re-read records and confirm postconditions.',
    boundary: 'Does not trust the write response; reads source tables directly.',
    input: z.object({ execution_id: z.string() }).strict(),
  },
};

export const AGENT_TOOLS = Object.values(TOOLS).filter((t) => t.callers.includes('agent')).map((t) => t.name);
