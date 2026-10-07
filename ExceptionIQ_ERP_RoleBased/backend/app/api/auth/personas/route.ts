import { json } from '@/src/http/handler';
import { config } from '@/src/config';
import { DEMO_USERS, DEMO_PASSWORD } from '@/src/fixtures/scenarios';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Demo-only convenience for the sign-in screen. Disabled when DEMO_MODE=false. */
export function GET() {
  if (!config.demoMode) return json({ personas: [] });
  return json({ password: DEMO_PASSWORD, personas: DEMO_USERS.map(({ email, name, role, entityIds, title, approvalLimitMinor }) => ({ email, name, role, entityIds, title, approvalLimitMinor })) });
}
