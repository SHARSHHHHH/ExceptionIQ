import { route } from '@/src/http/handler';
import { getDb } from '@/src/db';
import { requirePermission } from '@/src/security/rbac';
import { loadCaseFor } from '@/src/workflow/cases';
import { listAssignableAnalysts } from '@/src/workflow/users';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor, params }) => {
  requirePermission(actor, 'case:assign');
  const kase = loadCaseFor(getDb(), actor, params.id);
  return { assignees: listAssignableAnalysts(actor, kase.entity_id) };
});
