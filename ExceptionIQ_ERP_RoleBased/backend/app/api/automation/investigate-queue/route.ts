import { z } from 'zod';
import { route } from '@/src/http/handler';
import { investigateQueue } from '@/src/workflow/automation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ limit: z.number().int().min(1).max(50).optional() }).strict();
export const POST = route(({ actor, body }) => investigateQueue(actor, body.limit ?? 25), { body: Body });
