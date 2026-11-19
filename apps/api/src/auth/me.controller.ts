import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { type MeResponse, MeResponseSchema } from '@icon/contracts';
import type { PrismaClient } from '@icon/database';

import type { Principal } from '../access/principal.js';
import { toOpenApiSchema } from '../common/openapi.js';
import { PRISMA } from '../prisma/prisma.service.js';
import {
  AllowPendingMfaEnrollment,
  AllowPendingPasswordChange,
  CurrentPrincipal,
} from './decorators.js';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  @AllowPendingPasswordChange()
  @AllowPendingMfaEnrollment()
  @ApiResponse({ status: 200, schema: toOpenApiSchema(MeResponseSchema) })
  async me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    const [organization, roles, branches] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: principal.organizationId },
        select: { id: true, code: true, displayName: true },
      }),
      this.prisma.role.findMany({
        where: { id: { in: [...principal.roleIds] }, organizationId: principal.organizationId },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      principal.branchAccess === 'ALL'
        ? Promise.resolve(null)
        : this.prisma.branch.findMany({
            where: {
              id: { in: [...principal.branchAccess] },
              organizationId: principal.organizationId,
            },
            select: { id: true, code: true, name: true },
            orderBy: { code: 'asc' },
          }),
    ]);
    return {
      id: principal.userId,
      email: principal.email,
      fullName: principal.fullName,
      organization,
      roles,
      permissions: [...principal.permissions].sort(),
      branchAccess: branches ?? 'ALL',
      mustChangePassword: principal.mustChangePassword,
      mfaEnrollmentRequired: principal.mfaEnrollmentRequired,
      mfaEnabled: principal.mfaEnabled,
    };
  }
}
