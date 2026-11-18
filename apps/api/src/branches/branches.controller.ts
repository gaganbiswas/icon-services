import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Branch } from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { PRISMA } from '../prisma/prisma.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  timezone: true,
} satisfies Prisma.BranchSelect;

/** Branch reads, scoped to the organization and the principal's branch access. */
@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private scope(principal: Principal): Prisma.BranchWhereInput {
    return {
      organizationId: principal.organizationId,
      ...(principal.branchAccess === 'ALL' ? {} : { id: { in: [...principal.branchAccess] } }),
    };
  }

  @Get()
  @RequirePermissions('branches.read')
  list(@CurrentPrincipal() principal: Principal): Promise<Branch[]> {
    return this.prisma.branch.findMany({
      where: this.scope(principal),
      select: BRANCH_SELECT,
      orderBy: { code: 'asc' },
    });
  }

  @Get(':id')
  @RequirePermissions('branches.read')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({
      where: { AND: [{ id }, this.scope(principal)] },
      select: BRANCH_SELECT,
    });
    if (!branch) {
      throw AppException.notFound('Branch');
    }
    return branch;
  }
}
