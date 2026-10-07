import { route } from '@/src/http/handler';
import { claimCase } from '@/src/workflow/cases';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(({ actor, params }) => claimCase(params.id, actor));
