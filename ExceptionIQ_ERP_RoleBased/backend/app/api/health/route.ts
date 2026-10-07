import { json } from '@/src/http/handler';
import { getDb } from '@/src/db';
import { config } from '@/src/config';
import { policyVersion } from '@/src/rules/discountPolicy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const ok = !!getDb().prepare('SELECT 1 AS ok').get();
  return json({ name: 'ExceptionIQ API', status: ok ? 'ok' : 'degraded', version: '2.0.0', planner: config.planner, policy: policyVersion(), demoMode: config.demoMode });
}
