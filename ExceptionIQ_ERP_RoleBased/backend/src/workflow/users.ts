import { getDb } from '../db';
import { clock } from '../config';
import { Actor, DomainError, ROLES, Role } from '../domain/types';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../security/rbac';
import { recordDenial } from './cases';

interface UserRow { id: string; email: string; name: string; role: Role; entity_ids: string; title: string; approval_limit_minor: number; active: number; updated_at: string | null }

/** Directory for assignment pickers: active analysts in the given entity (any case reader may see names). */
export function listAssignableAnalysts(actor: Actor, entityId: string) {
  if (!actor.entityIds.includes(entityId)) return [];
  const rows = getDb().prepare("SELECT id, name, title, entity_ids FROM users WHERE role='ANALYST' AND active=1 ORDER BY name").all() as unknown as UserRow[];
  return rows.filter((u) => (JSON.parse(u.entity_ids) as string[]).includes(entityId)).map(({ id, name, title }) => ({ id, name, title }));
}

export function listUsers(actor: Actor) {
  requirePermission(actor, 'admin:users');
  const db = getDb();
  const rows = db.prepare('SELECT id, email, name, role, entity_ids, title, approval_limit_minor, active, updated_at FROM users ORDER BY role, name').all() as unknown as UserRow[];
  const workload = Object.fromEntries((db.prepare("SELECT assigned_to AS id, COUNT(*) AS n FROM cases WHERE status NOT IN ('CLOSED') AND assigned_to IS NOT NULL GROUP BY assigned_to").all() as { id: string; n: number }[]).map((r) => [r.id, r.n]));
  return rows.map((u) => ({ ...u, entityIds: JSON.parse(u.entity_ids) as string[], active: !!u.active, openCases: workload[u.id] ?? 0 }));
}

export interface UserPatch { role?: Role; entityIds?: string[]; approvalLimitMinor?: number; active?: boolean; title?: string }

/**
 * Administrators manage access but cannot use it to gain authority:
 *  - no changes to their own account (no self-elevation, no self-lockout);
 *  - approval limits exist only on CONTROLLER accounts (others are forced to 0);
 *  - the last active administrator cannot be removed or demoted;
 *  - analysts lose open assignments when they leave the analyst role or are deactivated.
 * Every change is audited with before/after values and takes effect on the user's next request.
 */
export function updateUser(actor: Actor, userId: string, patch: UserPatch) {
  requirePermission(actor, 'admin:users');
  const db = getDb();
  if (userId === actor.id) recordDenial(db, null, actor, 'admin.update_user', 'SELF_MODIFICATION', 'Administrators cannot change their own role, scope, limit or status', 403);
  const before = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as UserRow | undefined;
  if (!before) throw new DomainError('NOT_FOUND', 'User not found', 404);
  const role = patch.role ?? before.role;
  if (!ROLES.includes(role)) throw new DomainError('VALIDATION_FAILED', `Unknown role ${role}`, 400);
  const entities = (db.prepare('SELECT id FROM entities').all() as { id: string }[]).map((e) => e.id);
  const entityIds = patch.entityIds ?? (JSON.parse(before.entity_ids) as string[]);
  if (!entityIds.length || entityIds.some((e) => !entities.includes(e))) throw new DomainError('VALIDATION_FAILED', `Entity scope must be a non-empty subset of ${entities.join(', ')}`, 400);
  let limit = patch.approvalLimitMinor ?? before.approval_limit_minor;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new DomainError('VALIDATION_FAILED', 'Approval limit must be a non-negative whole amount', 400);
  if (role !== 'CONTROLLER') {
    if (patch.approvalLimitMinor && patch.approvalLimitMinor > 0) recordDenial(db, null, actor, 'admin.update_user', 'SOD_APPROVAL_LIMIT', 'Only controllers can hold an approval limit', 400);
    limit = 0;
  }
  const active = patch.active ?? !!before.active;
  if (before.role === 'ADMIN' && (role !== 'ADMIN' || !active)) {
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND active=1").get() as { n: number }).n;
    if (admins <= 1) throw new DomainError('LAST_ADMIN', 'At least one active administrator must remain', 409);
  }
  const now = clock.now().toISOString();
  db.prepare('UPDATE users SET role=?, entity_ids=?, approval_limit_minor=?, active=?, title=?, updated_at=? WHERE id=?')
    .run(role, JSON.stringify(entityIds), limit, active ? 1 : 0, (patch.title ?? before.title).slice(0, 80), now, userId);
  let released = 0;
  if (before.role === 'ANALYST' && (role !== 'ANALYST' || !active)) {
    released = Number(db.prepare("UPDATE cases SET assigned_to=NULL, version=version+1, updated_at=? WHERE assigned_to=? AND status <> 'CLOSED'").run(now, userId).changes);
  }
  const after = { role, entityIds, approvalLimitMinor: limit, active };
  appendAudit(db, { actor, type: 'USER_ACCESS_CHANGED', summary: `${before.name}: ${before.role}→${role}, limit ${before.approval_limit_minor}→${limit}, ${before.active ? 'active' : 'inactive'}→${active ? 'active' : 'inactive'}${released ? `, ${released} case(s) released` : ''}`,
    data: { userId, before: { role: before.role, entityIds: JSON.parse(before.entity_ids), approvalLimitMinor: before.approval_limit_minor, active: !!before.active }, after, releasedCases: released } });
  return { ok: true, user: { id: userId, ...after }, releasedCases: released };
}
