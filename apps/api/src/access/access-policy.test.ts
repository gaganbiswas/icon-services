import type { PermissionCode } from '@icon/contracts';
import { describe, expect, it } from 'vitest';

import {
  branchFilter,
  canAccessBranch,
  canManageUser,
  holdsAll,
  mergeBranchAccess,
} from './access-policy.js';
import type { Principal } from './principal.js';

function principal(
  permissions: PermissionCode[],
  branchAccess: 'ALL' | string[],
  userId = 'actor',
): Principal {
  return {
    userId,
    sessionId: 's',
    organizationId: 'org',
    email: 'a@example.test',
    fullName: 'A',
    mustChangePassword: false,
    mfaEnrollmentRequired: false,
    mfaEnabled: false,
    roleIds: new Set(),
    permissions: new Set(permissions),
    branchAccess: branchAccess === 'ALL' ? 'ALL' : new Set(branchAccess),
  };
}

describe('holdsAll', () => {
  it('requires every permission', () => {
    const p = principal(['users.read', 'users.manage'], []);
    expect(holdsAll(p, ['users.read'])).toBe(true);
    expect(holdsAll(p, ['users.read', 'roles.manage'])).toBe(false);
    expect(holdsAll(p, [])).toBe(true);
  });
});

describe('branch scope', () => {
  it('grants every branch with ALL access', () => {
    const p = principal([], 'ALL');
    expect(canAccessBranch(p, 'any')).toBe(true);
    expect(branchFilter(p)).toEqual({});
  });

  it('restricts to explicit branches otherwise', () => {
    const p = principal([], ['b1']);
    expect(canAccessBranch(p, 'b1')).toBe(true);
    expect(canAccessBranch(p, 'b2')).toBe(false);
    expect(branchFilter(p)).toEqual({ branchId: { in: ['b1'] } });
  });

  it('gives no access when the user has no branches', () => {
    expect(branchFilter(principal([], []))).toEqual({ branchId: { in: [] } });
  });
});

describe('canManageUser', () => {
  const actor = principal(['users.manage', 'jobs.read'], ['b1']);

  it('allows managing users with a subset of permissions', () => {
    expect(canManageUser(actor, { id: 't', permissions: new Set(['jobs.read']) })).toBe(true);
  });

  it('blocks managing users with permissions the actor lacks', () => {
    expect(canManageUser(actor, { id: 't', permissions: new Set(['roles.manage']) })).toBe(false);
  });

  it('blocks self-management', () => {
    expect(canManageUser(actor, { id: 'actor', permissions: new Set() })).toBe(false);
  });
});

describe('mergeBranchAccess', () => {
  const actor = principal([], ['b1', 'b2']);

  it('preserves branches outside the actor scope', () => {
    expect(mergeBranchAccess(actor, ['b1', 'b9'], ['b2'])?.sort()).toEqual(['b2', 'b9']);
  });

  it('rejects granting branches outside the actor scope', () => {
    expect(mergeBranchAccess(actor, [], ['b3'])).toBeNull();
  });

  it('allows an all-branch actor to set anything', () => {
    expect(mergeBranchAccess(principal([], 'ALL'), ['b1'], ['b3'])).toEqual(['b3']);
  });
});
