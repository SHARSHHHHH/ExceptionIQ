import { z } from 'zod';
import { route } from '@/src/http/handler';
import { addNote } from '@/src/workflow/cases';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ body: z.string().min(2).max(2000) }).strict();
export const POST = route(({ actor, params, body }) => addNote(params.id, body.body, actor), { body: Body });
