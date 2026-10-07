import { route } from '@/src/http/handler';
import { exportCaseAudit } from '@/src/workflow/queries';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor, params }) => exportCaseAudit(actor, params.id));
