import { route } from '@/src/http/handler';
import { listAudit } from '@/src/workflow/queries';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor, req }) => listAudit(actor, Number(new URL(req.url).searchParams.get('limit') ?? 300)));
