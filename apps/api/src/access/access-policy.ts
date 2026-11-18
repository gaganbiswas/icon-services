import type { PermissionCode } from '@icon/contracts';

import type { Principal } from './principal.js';

export function hasPermission(principal: Principal, permission: PermissionCode): boolean {
  return principal.permissions.has(permission);
}

/** True when every permission in `wanted` is held by the principal. */
export function holdsAll(principal: Principal, wanted: Iterable<string>): boolean {
  for (const permission of wanted) {
    if (!principal.permissions.has(permission as PermissionCode)) {
      return false;
    }
  }
  return true;
}

export function canAccessBranch(principal: Principal, branchId: string): boolean {
  return principal.branchAccess === 'ALL' || principal.branchAccess.has(branchId);
}

/**
 * Prisma `where` fragment restricting branch-owned rows to the principal's
 * branches. Returns an empty object for all-branch access.
 */
export function branchFilter(principal: Principal): { branchId?: { in: string[] } } {
  return principal.branchAccess === 'ALL' ? {} : { branchId: { in: [...principal.branchAccess] } };
}

export interface ManagedUserView {
  readonly id: string;
  /** Union of permissions from all of the target's roles. */
  readonly permissions: ReadonlySet<string>;
}

/**
 * Escalation guard (ADR 0010): an actor may manage another user only if the
 * target holds no permission the actor lacks. Nobody manages themselves here.
 */
export function canManageUser(actor: Principal, target: ManagedUserView): boolean {
  return actor.userId !== target.id && holdsAll(actor, target.permissions);
}

/**
 * Computes the branch set after an actor edits a user's branch access.
 * Branches outside the actor's scope are preserved untouched; the requested
 * set must lie entirely inside the actor's scope.
 * Returns null when the request includes branches the actor cannot grant.
 */
export function mergeBranchAccess(
  actor: Principal,
  current: readonly string[],
  requested: readonly string[],
): string[] | null {
  if (!requested.every((id) => canAccessBranch(actor, id))) {
    return null;
  }
  const preserved = current.filter((id) => !canAccessBranch(actor, id));
  return [...new Set([...preserved, ...requested])];
}
