import { route } from '@/src/http/handler';
import { investigateCase } from '@/src/workflow/investigate';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(({ actor, params }) => investigateCase(params.id, actor));
