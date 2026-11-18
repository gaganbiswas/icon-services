import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateRoleRequest,
  PERMISSIONS,
  PERMISSION_CODES,
  type PermissionCode,
  type Role,
  type UpdateRoleRequest,
  isPermissionCode,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { holdsAll } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { PRISMA } from '../prisma/prisma.service.js';

const ROLE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  isSystem: true,
  version: true,
  permissions: { select: { permission: { select: { code: true } } } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

/** Roles whose permission set is locked (lock-out protection, ADR 0010). */
const LOCKED_ROLE_CODES = new Set(['SUPER_ADMIN']);

function toRoleDto(row: RoleRow): Role {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    version: row.version,
    permissions: row.permissions
      .map((p) => p.permission.code)
      .filter(isPermissionCode)
      .sort(),
  };
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  listPermissions(): { code: PermissionCode; description: string }[] {
    return PERMISSION_CODES.map((code) => ({ code, description: PERMISSIONS[code] }));
  }

  async list(principal: Principal): Promise<Role[]> {
    const rows = await this.prisma.role.findMany({
      where: { organizationId: principal.organizationId },
      select: ROLE_SELECT,
      orderBy: { name: 'asc' },
    });
    return rows.map(toRoleDto);
  }

  async create(actor: Principal, input: CreateRoleRequest): Promise<Role> {
    if (!holdsAll(actor, input.permissions)) {
      throw AppException.forbidden('You cannot grant permissions you do not hold');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const permissionIds = await this.permissionIds(tx, input.permissions);
        const row = await tx.role.create({
          data: {
            organizationId: actor.organizationId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
          },
          select: ROLE_SELECT,
        });
        const dto = toRoleDto(row);
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          action: 'role.created',
          entityType: 'role',
          entityId: row.id,
          after: dto,
        });
        return dto;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict('A role with this code already exists');
      }
      throw error;
    }
  }

  async update(actor: Principal, id: string, input: UpdateRoleRequest): Promise<Role> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.role.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: ROLE_SELECT,
      });
      if (!row) {
        throw AppException.notFound('Role');
      }
      const before = toRoleDto(row);
      if (before.version !== input.version) {
        throw AppException.versionConflict();
      }
      // Escalation guard: only edit roles entirely within your own permissions.
      if (!holdsAll(actor, before.permissions)) {
        throw AppException.forbidden('You cannot edit a role with permissions you do not hold');
      }
      if (input.permissions !== undefined) {
        if (LOCKED_ROLE_CODES.has(row.code)) {
          throw AppException.forbidden('The Super Admin role always holds every permission');
        }
        if (!holdsAll(actor, input.permissions)) {
          throw AppException.forbidden('You cannot grant permissions you do not hold');
        }
      }

      const bumped = await tx.role.updateMany({
        where: { id, version: input.version },
        data: {
          version: { increment: 1 },
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      if (bumped.count !== 1) {
        throw AppException.versionConflict();
      }
      if (input.permissions !== undefined) {
        const permissionIds = await this.permissionIds(tx, input.permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
      const after = toRoleDto(
        await tx.role.findUniqueOrThrow({ where: { id }, select: ROLE_SELECT }),
      );
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: 'role.updated',
        entityType: 'role',
        entityId: id,
        before,
        after,
        reason: input.reason,
      });
      return after;
    });
  }

  private async permissionIds(
    tx: Prisma.TransactionClient,
    codes: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(codes)];
    const rows = await tx.permission.findMany({
      where: { code: { in: unique } },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new Error('Permission catalogue is not seeded; run the RBAC seed');
    }
    return rows.map((row) => row.id);
  }
}
