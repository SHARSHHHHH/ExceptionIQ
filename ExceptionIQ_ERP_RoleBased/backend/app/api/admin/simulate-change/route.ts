import { z } from 'zod';
import { route } from '@/src/http/handler';
import { simulateSourceChange } from '@/src/workflow/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ caseId: z.string().min(1).max(40) }).strict();
export const POST = route(({ actor, body }) => simulateSourceChange(actor, body.caseId), { body: Body });
