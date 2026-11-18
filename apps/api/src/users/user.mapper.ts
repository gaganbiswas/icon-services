import type { User } from '@icon/contracts';
import type { Prisma } from '@icon/database';

export const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  lockedUntil: true,
  mustChangePassword: true,
  lastLoginAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: {
      role: {
        select: {
          id: true,
          code: true,
          name: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
    },
  },
  branchAccess: { select: { branch: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export function userPermissions(row: UserRow): Set<string> {
  return new Set(row.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)));
}

export function toUserDto(row: UserRow, now = new Date()): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    isActive: row.isActive,
    isLocked: row.lockedUntil !== null && row.lockedUntil > now,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    roles: row.roles
      .map(({ role }) => ({ id: role.id, code: role.code, name: role.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    branches: row.branchAccess
      .map(({ branch }) => branch)
      .sort((a, b) => a.code.localeCompare(b.code)),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Audit snapshot: identifiers only, no secrets. */
export function auditSnapshot(row: UserRow) {
  return {
    email: row.email,
    fullName: row.fullName,
    isActive: row.isActive,
    roles: row.roles.map(({ role }) => role.code).sort(),
    branchIds: row.branchAccess.map(({ branch }) => branch.id).sort(),
  };
}
