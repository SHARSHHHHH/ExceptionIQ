import { route } from '@/src/http/handler';
import { listBatches } from '@/src/ingest/statement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor }) => ({ batches: listBatches(actor) }));
