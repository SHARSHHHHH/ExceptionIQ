import { z } from 'zod';
import { route } from '@/src/http/handler';
import { assignCase } from '@/src/workflow/cases';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ assigneeId: z.string().min(1).max(40).nullable() }).strict();
export const POST = route(({ actor, params, body }) => assignCase(params.id, body.assigneeId, actor), { body: Body });
