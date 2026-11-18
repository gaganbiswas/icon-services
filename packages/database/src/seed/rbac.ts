import { PERMISSIONS, PERMISSION_CODES, SYSTEM_ROLES } from '@icon/contracts';

import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/**
 * Inserts any missing permission codes and refreshes descriptions.
 * Safe to run repeatedly and in every environment.
 */
export async function ensurePermissions(tx: Tx): Promise<void> {
  for (const code of PERMISSION_CODES) {
    await tx.permission.upsert({
      where: { code },
      create: { code, description: PERMISSIONS[code] },
      update: { description: PERMISSIONS[code] },
    });
  }
}

/**
 * Creates any missing system roles for an organization with their default
 * permissions. Existing roles are NOT modified (administrators may have changed
 * them), except SUPER_ADMIN which always holds every permission.
 */
export async function ensureSystemRoles(tx: Tx, organizationId: string): Promise<void> {
  const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(permissions.map((p) => [p.code, p.id]));

  for (const definition of SYSTEM_ROLES) {
    const existing = await tx.role.findUnique({
      where: { organizationId_code: { organizationId, code: definition.code } },
    });
    const wanted = definition.permissions.map((code) => {
      const id = idByCode.get(code);
      if (!id) {
        throw new Error(`Permission ${code} missing; run ensurePermissions first`);
      }
      return id;
    });

    if (!existing) {
      await tx.role.create({
        data: {
          organizationId,
          code: definition.code,
          name: definition.name,
          description: definition.description,
          isSystem: true,
          permissions: { create: wanted.map((permissionId) => ({ permissionId })) },
        },
      });
    } else if (definition.code === 'SUPER_ADMIN') {
      await tx.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: existing.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
}
