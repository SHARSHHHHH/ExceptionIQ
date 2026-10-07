import { route } from '@/src/http/handler';
import { getCaseDetail } from '@/src/workflow/queries';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor, params }) => getCaseDetail(actor, params.id));
