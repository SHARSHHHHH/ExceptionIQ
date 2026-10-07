import { z } from 'zod';
import { route } from '@/src/http/handler';
import { decideProposal } from '@/src/workflow/approvals';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ proposalId: z.string().min(1).max(40), decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().max(1000).optional() }).strict();

export const POST = route(({ actor, params, body }) => decideProposal(params.id, body.proposalId, body.decision, body.reason, actor), { body: Body });
