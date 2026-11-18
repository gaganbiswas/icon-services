import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateUserRequest,
  CreatedUserResponse,
  Page,
  PaginationQuery,
  PasswordSetupTokenResponse,
  UpdateUserRequest,
  User,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import {
  canAccessBranch,
  canManageUser,
  holdsAll,
  mergeBranchAccess,
} from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, normalizeEmail } from '../auth/auth.service.js';
import { AppException } from '../common/app-exception.js';
import { PRISMA } from '../prisma/prisma.service.js';
import {
  USER_SELECT,
  type UserRow,
  auditSnapshot,
  toUserDto,
  userPermissions,
} from './user.mapper.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** Org scope always; branch-scoped actors see only users sharing one of their branches. */
  private visibleTo(principal: Principal): Prisma.UserWhereInput {
    return {
      organizationId: principal.organizationId,
      ...(principal.branchAccess === 'ALL'
        ? {}
        : { branchAccess: { some: { branchId: { in: [...principal.branchAccess] } } } }),
    };
  }

  async list(principal: Principal, query: PaginationQuery): Promise<Page<User>> {
    const where = this.visibleTo(principal);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map((row) => toUserDto(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(principal: Principal, id: string): Promise<User> {
    return toUserDto(await this.findVisible(this.prisma, principal, id));
  }

  async create(actor: Principal, input: CreateUserRequest): Promise<CreatedUserResponse> {
    const emailNormalized = normalizeEmail(input.email);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertAssignableRoles(tx, actor, input.roleIds);
        await this.assertGrantableBranches(tx, actor, input.branchIds);
        const { id: userId } = await tx.user.create({
          data: {
            organizationId: actor.organizationId,
            email: input.email,
            emailNormalized,
            fullName: input.fullName,
          },
          select: { id: true },
        });
        // Explicit inserts: the composite tenant foreign keys share organization_id.
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({
            userId,
            roleId,
            organizationId: actor.organizationId,
            assignedById: actor.userId,
          })),
        });
        await tx.userBranchAccess.createMany({
          data: input.branchIds.map((branchId) => ({
            userId,
            branchId,
            organizationId: actor.organizationId,
            grantedById: actor.userId,
          })),
        });
        const created = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: USER_SELECT,
        });
        const setup = await this.auth.issuePasswordSetupToken(
          tx,
          created.id,
          'INITIAL_SETUP',
          actor.userId,
        );
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          action: 'user.created',
          entityType: 'user',
          entityId: created.id,
          after: auditSnapshot(created),
        });
        return {
          user: toUserDto(created),
          passwordSetup: { token: setup.token, expiresAt: setup.expiresAt.toISOString() },
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict('A user with this e-mail already exists');
      }
      throw error;
    }
  }

  async update(actor: Principal, id: string, input: UpdateUserRequest): Promise<User> {
    const changesAccess =
      input.roleIds !== undefined || input.branchIds !== undefined || input.isActive !== undefined;
    if (id === actor.userId && changesAccess) {
      throw AppException.forbidden('You cannot change your own roles, branches or active status');
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await this.findVisible(tx, actor, id);
      if (
        !canManageUser(actor, { id: before.id, permissions: userPermissions(before) }) &&
        id !== actor.userId
      ) {
        throw AppException.forbidden('You cannot manage a user with permissions you do not hold');
      }
      if (before.version !== input.version) {
        throw AppException.versionConflict();
      }

      if (input.roleIds !== undefined) {
        await this.assertAssignableRoles(tx, actor, input.roleIds);
      }
      let branchIds: string[] | undefined;
      if (input.branchIds !== undefined) {
        await this.assertGrantableBranches(tx, actor, input.branchIds);
        const merged = mergeBranchAccess(
          actor,
          before.branchAccess.map(({ branch }) => branch.id),
          input.branchIds,
        );
        if (!merged) {
          throw AppException.forbidden('You cannot grant access to branches you do not manage');
        }
        branchIds = merged;
      }

      // Optimistic concurrency: the version must still match at write time.
      const bumped = await tx.user.updateMany({
        where: { id, organizationId: actor.organizationId, version: input.version },
        data: {
          version: { increment: 1 },
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      if (bumped.count !== 1) {
        throw AppException.versionConflict();
      }
      if (input.roleIds !== undefined) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({
            userId: id,
            roleId,
            organizationId: actor.organizationId,
            assignedById: actor.userId,
          })),
        });
      }
      if (branchIds !== undefined) {
        await tx.userBranchAccess.deleteMany({ where: { userId: id } });
        await tx.userBranchAccess.createMany({
          data: branchIds.map((branchId) => ({
            userId: id,
            branchId,
            organizationId: actor.organizationId,
            grantedById: actor.userId,
          })),
        });
      }
      if (input.isActive === false && before.isActive) {
        await this.auth.revokeSessions(tx, { userId: id }, 'USER_DEACTIVATED');
      }

      const after = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: input.isActive === false && before.isActive ? 'user.deactivated' : 'user.updated',
        entityType: 'user',
        entityId: id,
        before: auditSnapshot(before),
        after: auditSnapshot(after),
        reason: input.reason ?? null,
      });
      return toUserDto(after);
    });
  }

  async issuePasswordSetup(actor: Principal, id: string): Promise<PasswordSetupTokenResponse> {
    if (id === actor.userId) {
      throw AppException.forbidden('Use “change password” for your own account');
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await this.findVisible(tx, actor, id);
      if (!canManageUser(actor, { id: target.id, permissions: userPermissions(target) })) {
        throw AppException.forbidden('You cannot manage a user with permissions you do not hold');
      }
      if (!target.isActive) {
        throw AppException.conflict('Reactivate the user before issuing a password set-up link');
      }
      const setup = await this.auth.issuePasswordSetupToken(tx, id, 'ADMIN_RESET', actor.userId);
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: 'user.password_setup_issued',
        entityType: 'user',
        entityId: id,
        after: { expiresAt: setup.expiresAt },
      });
      return { token: setup.token, expiresAt: setup.expiresAt.toISOString() };
    });
  }

  // ------------------------------------------------------------- helpers

  private async findVisible(
    db: Prisma.TransactionClient | PrismaClient,
    principal: Principal,
    id: string,
  ): Promise<UserRow> {
    const row = await db.user.findFirst({
      where: { id, ...this.visibleTo(principal) },
      select: USER_SELECT,
    });
    if (!row) {
      throw AppException.notFound('User');
    }
    return row;
  }

  private async assertAssignableRoles(
    tx: Prisma.TransactionClient,
    actor: Principal,
    roleIds: readonly string[],
  ): Promise<void> {
    if (roleIds.length === 0) {
      return;
    }
    const roles = await tx.role.findMany({
      where: { id: { in: [...roleIds] }, organizationId: actor.organizationId },
      select: { id: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    if (roles.length !== new Set(roleIds).size) {
      throw AppException.notFound('Role');
    }
    const wanted = roles.flatMap((role) => role.permissions.map((p) => p.permission.code));
    if (!holdsAll(actor, wanted)) {
      throw AppException.forbidden('You cannot assign a role with permissions you do not hold');
    }
  }

  private async assertGrantableBranches(
    tx: Prisma.TransactionClient,
    actor: Principal,
    branchIds: readonly string[],
  ): Promise<void> {
    if (branchIds.length === 0) {
      return;
    }
    const count = await tx.branch.count({
      where: { id: { in: [...branchIds] }, organizationId: actor.organizationId },
    });
    if (count !== new Set(branchIds).size) {
      throw AppException.notFound('Branch');
    }
    if (!branchIds.every((id) => canAccessBranch(actor, id))) {
      throw AppException.forbidden('You cannot grant access to branches you do not manage');
    }
  }
}
