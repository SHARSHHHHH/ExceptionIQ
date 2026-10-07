import { route } from '@/src/http/handler';
import { aiStatus } from '@/src/ai/client';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(() => aiStatus());
