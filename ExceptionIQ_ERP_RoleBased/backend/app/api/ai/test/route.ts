import { route } from '@/src/http/handler';
import { testAiConnection } from '@/src/ai/copilot';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(({ actor }) => testAiConnection(actor));
