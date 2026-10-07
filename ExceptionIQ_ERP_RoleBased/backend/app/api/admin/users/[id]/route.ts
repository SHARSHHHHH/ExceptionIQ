import { z } from 'zod';
import { route } from '@/src/http/handler';
import { updateUser } from '@/src/workflow/users';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  role: z.enum(['ANALYST', 'CONTROLLER', 'ADMIN', 'AUDITOR']).optional(),
  entityIds: z.array(z.string().min(2).max(10)).min(1).max(10).optional(),
  approvalLimitMinor: z.number().int().min(0).max(1_000_000_000_00).optional(),
  active: z.boolean().optional(),
  title: z.string().max(80).optional(),
}).strict();
export const POST = route(({ actor, params, body }) => updateUser(actor, params.id, body), { body: Body });
