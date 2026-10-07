import { route } from '@/src/http/handler';
import { permissionsFor, ROLE_PROFILES } from '@/src/security/rbac';
import { aiStatus } from '@/src/ai/client';
import type { Role } from '@/src/domain/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor }) => ({
  user: actor,
  permissions: permissionsFor(actor),
  profile: ROLE_PROFILES[actor.role as Role],
  ai: aiStatus(),
}));
