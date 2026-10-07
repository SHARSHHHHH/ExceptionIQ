import { route } from '@/src/http/handler';
import { caseBriefing } from '@/src/ai/copilot';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(({ actor, params }) => caseBriefing(actor, params.id));
