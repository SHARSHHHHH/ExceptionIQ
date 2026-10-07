import { z } from 'zod';
import { route } from '@/src/http/handler';
import { executeProposal } from '@/src/workflow/execute';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ proposalId: z.string().min(1).max(40) }).strict();

export const POST = route(({ actor, params, body }) => executeProposal(params.id, body.proposalId, actor), { body: Body });
