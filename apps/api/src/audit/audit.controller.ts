import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type AuditLog,
  type AuditLogQuery,
  AuditLogQuerySchema,
  type Page,
  PaginationQuerySchema,
} from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PRISMA } from '../prisma/prisma.service.js';

const QuerySchema = PaginationQuerySchema.extend(AuditLogQuerySchema.shape);

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  @RequirePermissions('audit.read')
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(QuerySchema))
    query: AuditLogQuery & { page: number; pageSize: number },
  ): Promise<Page<AuditLog>> {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: principal.organizationId,
      ...(principal.branchAccess === 'ALL'
        ? {}
        : { OR: [{ branchId: null }, { branchId: { in: [...principal.branchAccess] } }] }),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actorUserId: row.actorUserId,
        actorType: row.actorType,
        branchId: row.branchId,
        before: row.before,
        after: row.after,
        reason: row.reason,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
