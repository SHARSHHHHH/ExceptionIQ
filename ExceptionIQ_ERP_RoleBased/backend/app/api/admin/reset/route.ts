import { route } from '@/src/http/handler';
import { resetDemo } from '@/src/workflow/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(({ actor }) => resetDemo(actor));
