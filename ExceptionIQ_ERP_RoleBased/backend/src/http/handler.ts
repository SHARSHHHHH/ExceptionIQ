import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { Actor, DomainError } from '../domain/types';
import { actorFromToken } from '../security/session';

type Params = Record<string, string>;
interface Ctx<B> { req: Request; actor: Actor; params: Params; body: B }

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Wraps every API route: authenticate → validate body with zod → run → map errors.
 * Internal errors never leak stack traces or SQL to the client.
 */
export function route<B = undefined>(fn: (ctx: Ctx<B>) => unknown | Promise<unknown>, opts: { body?: z.ZodType<B>; public?: false } = {}) {
  return async (req: Request, context: { params: Promise<Params> }) => {
    try {
      const actor = actorFromToken(bearer(req));
      const params = (await context?.params) ?? {};
      let body = undefined as B;
      if (opts.body) {
        const raw = await req.json().catch(() => { throw new DomainError('INVALID_JSON', 'Request body must be JSON', 400); });
        body = opts.body.parse(raw);
      }
      return json(await fn({ req, actor, params, body }));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof DomainError) return json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, e.httpStatus);
  if (e instanceof ZodError) return json({ error: { code: 'VALIDATION_FAILED', message: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }, 400);
  console.error('[exceptioniq] unhandled error', e);
  return json({ error: { code: 'INTERNAL', message: 'Internal error' } }, 500);
}
