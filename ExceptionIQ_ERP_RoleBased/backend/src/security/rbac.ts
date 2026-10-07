import { Actor, DomainError, Role } from '../domain/types';

/**
 * Deny-by-default permission matrix. This is the single source of truth: the API enforces it on every
 * request and the UI only mirrors it (via /api/auth/me) to hide controls a user cannot use.
 *
 * Separation of duties (SoD):
 *  - ANALYST investigates and proposes, never approves.
 *  - CONTROLLER approves within a delegation-of-authority limit, never investigates.
 *  - ADMIN runs the platform (users, scenarios, AI configuration) and holds NO financial authority.
 *  - AUDITOR has read-only access to everything in scope, including full audit export, and can change nothing.
 */
export const PERMISSIONS = {
  // Cases
  'case:read':        ['ANALYST', 'CONTROLLER', 'ADMIN', 'AUDITOR'],
  'case:claim':       ['ANALYST'],
  'case:assign':      ['CONTROLLER'],
  'case:investigate': ['ANALYST'],
  'case:comment':     ['ANALYST', 'CONTROLLER', 'AUDITOR'],
  // Money movement chain
  'approval:decide':   ['CONTROLLER'],
  'execution:trigger': ['ANALYST', 'CONTROLLER'],
  // Data automation
  'ingest:statement': ['ANALYST', 'CONTROLLER'],
  'automation:batch': ['ANALYST'],
  // AI assistance (advisory only; never an authority)
  'ai:assist': ['ANALYST', 'CONTROLLER', 'ADMIN', 'AUDITOR'],
  'ai:configure': ['ADMIN'],
  // Assurance
  'audit:read':   ['CONTROLLER', 'ADMIN', 'AUDITOR'],
  'audit:export': ['CONTROLLER', 'AUDITOR'],
  'catalog:read': ['ANALYST', 'CONTROLLER', 'ADMIN', 'AUDITOR'],
  'tools:read':   ['ANALYST', 'ADMIN', 'AUDITOR'],
  // Platform administration
  'admin:users':    ['ADMIN'],
  'admin:reset':    ['ADMIN'],
  'admin:simulate': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const ROLE_PROFILES: Record<Role, { label: string; mandate: string; cannot: string[] }> = {
  ANALYST: {
    label: 'Reconciliation analyst',
    mandate: 'Imports bank statements, claims and investigates exceptions, prepares rule-checked proposals.',
    cannot: ['Approve any proposal', 'Investigate a case assigned to someone else', 'Read the global audit log', 'Manage users'],
  },
  CONTROLLER: {
    label: 'Finance controller',
    mandate: 'Assigns work, approves or rejects exact proposals within a delegation-of-authority limit.',
    cannot: ['Investigate cases', 'Approve above their limit', 'Approve a proposal they prepared', 'Manage users or reset data'],
  },
  ADMIN: {
    label: 'System administrator',
    mandate: 'Manages users and roles, AI configuration, scenarios and platform health.',
    cannot: ['Investigate', 'Approve', 'Execute', 'Change their own role or limit', 'Grant approval authority to non-controllers'],
  },
  AUDITOR: {
    label: 'Internal auditor',
    mandate: 'Read-only assurance: reviews evidence, approvals, the hash-chained audit log and exports bundles.',
    cannot: ['Change any data', 'Approve', 'Execute', 'Import or investigate'],
  },
};

export function can(actor: Actor, perm: Permission): boolean {
  return actor.role !== 'SERVICE' && (PERMISSIONS[perm] as readonly string[]).includes(actor.role);
}

export function permissionsFor(actor: Actor): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(actor, p));
}

export function requirePermission(actor: Actor, perm: Permission): void {
  if (!can(actor, perm)) throw new DomainError('FORBIDDEN', `Your role (${actor.role}) does not have permission "${perm}"`, 403);
}

/** Entity (tenant) boundary, enforced on every case-scoped operation. Cases outside scope are reported as not found. */
export function requireEntity(actor: Actor, entityId: string): void {
  if (!actor.entityIds.includes(entityId)) throw new DomainError('NOT_FOUND', 'Case not found', 404);
}
