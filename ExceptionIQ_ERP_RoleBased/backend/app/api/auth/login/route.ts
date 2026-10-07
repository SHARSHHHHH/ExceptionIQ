import { z } from 'zod';
import { json, errorResponse } from '@/src/http/handler';
import { login } from '@/src/security/session';
import { appendAudit } from '@/src/audit/audit';
import { getDb } from '@/src/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).strict();

export async function POST(req: Request) {
  try {
    const { email, password } = Body.parse(await req.json());
    const result = login(email, password);
    appendAudit(getDb(), { actor: result.actor, type: 'USER_SIGNED_IN', summary: `${result.actor.name} signed in` });
    return json({ token: result.token, user: { ...result.actor, email: result.email } });
  } catch (e) {
    return errorResponse(e);
  }
}
