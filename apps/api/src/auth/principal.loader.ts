import { Inject, Injectable } from '@nestjs/common';
import { type PermissionCode, isPermissionCode } from '@icon/contracts';
import type { PrismaClient } from '@icon/database';

import type { Principal } from '../access/principal.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { isPrivileged } from '../mfa/mfa.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import type { AccessTokenClaims } from './token.service.js';

/** Resolves the current principal from the database (no permission caching). */
@Injectable()
export class PrincipalLoader {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async load(claims: AccessTokenClaims): Promise<Principal | null> {
    const now = new Date();
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sessionId,
        userId: claims.userId,
        subjectType: 'STAFF',
        revokedAt: null,
        expiresAt: { gt: now },
        user: {
          organizationId: claims.organizationId,
          isActive: true,
          organization: { isActive: true },
        },
      },
      select: {
        id: true,
        user: {
          select: {
            id: true,
            organizationId: true,
            email: true,
            fullName: true,
            mustChangePassword: true,
            mfa: { select: { enabledAt: true } },
            roles: {
              select: {
                roleId: true,
                role: {
                  select: { permissions: { select: { permission: { select: { code: true } } } } },
                },
              },
            },
            branchAccess: { select: { branchId: true, branch: { select: { isActive: true } } } },
          },
        },
      },
    });
    const user = session?.user;
    if (!session || !user) {
      return null;
    }
    const permissions = new Set<PermissionCode>();
    for (const userRole of user.roles) {
      for (const { permission } of userRole.role.permissions) {
        if (isPermissionCode(permission.code)) {
          permissions.add(permission.code);
        }
      }
    }
    return {
      userId: user.id,
      sessionId: session.id,
      organizationId: user.organizationId,
      email: user.email,
      fullName: user.fullName,
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: Boolean(user.mfa?.enabledAt),
      mfaEnrollmentRequired:
        this.env.MFA_ENFORCEMENT === 'required' &&
        !user.mfa?.enabledAt &&
        isPrivileged(permissions),
      roleIds: new Set(user.roles.map((r) => r.roleId)),
      permissions,
      branchAccess: permissions.has('branches.all')
        ? 'ALL'
        : new Set(user.branchAccess.filter((a) => a.branch.isActive).map((a) => a.branchId)),
    };
  }
}
