import { route } from '@/src/http/handler';
import { openLedger } from '@/src/ingest/statement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor, req }) => ({ items: openLedger(actor, new URL(req.url).searchParams.get('entity') ?? actor.entityIds[0]) }));
