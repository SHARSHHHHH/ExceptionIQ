import { route } from '@/src/http/handler';
import { getMetrics } from '@/src/workflow/queries';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor }) => getMetrics(actor));
