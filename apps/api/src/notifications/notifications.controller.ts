import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type Notification, type Page, PaginationQuerySchema } from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';
import { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PRISMA } from '../prisma/prisma.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const Query_ = PaginationQuerySchema.extend({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD', 'SKIPPED']).optional(),
  jobId: z.uuid().optional(),
});

/** Notification centre: status of queued messages and manual retry (CLAUDE.md §4.10). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  private scope(principal: Principal): Prisma.NotificationOutboxWhereInput {
    return {
      organizationId: principal.organizationId,
      ...(principal.branchAccess === 'ALL'
        ? {}
        : { branchId: { in: [...principal.branchAccess] } }),
    };
  }

  @Get()
  @RequirePermissions('notifications.read')
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(Query_)) query: z.infer<typeof Query_>,
  ): Promise<Page<Notification>> {
    const where: Prisma.NotificationOutboxWhereInput = {
      ...this.scope(principal),
      ...(query.status ? { status: query.status } : {}),
      ...(query.jobId ? { aggregateId: query.jobId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notificationOutbox.findMany({
        where,
        include: { deliveries: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notificationOutbox.count({ where }),
    ]);
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        jobId: r.aggregateType === 'service_job' ? r.aggregateId : null,
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt:
          r.status === 'PENDING' || r.status === 'FAILED' ? r.nextAttemptAt.toISOString() : null,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
        deliveries: r.deliveries.map((d) => ({
          channel: d.channel,
          provider: d.provider,
          status: d.status,
          providerMessageId: d.providerMessageId,
          errorCode: d.errorCode,
          createdAt: d.createdAt.toISOString(),
        })),
      })),
    };
  }

  @Post(':id/retry')
  @RequirePermissions('notifications.retry')
  async retry(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<{ status: string }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.notificationOutbox.findFirst({
        where: { id, ...this.scope(principal) },
      });
      if (!row) throw AppException.notFound('Notification');
      if (row.status !== 'FAILED' && row.status !== 'DEAD') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Only failed notifications can be retried',
        );
      }
      await tx.notificationOutbox.update({
        where: { id },
        // Attempt numbers keep counting (deliveries are unique per attempt); a
        // manual retry after the limit gets one more attempt.
        data: { status: 'PENDING', nextAttemptAt: new Date(), lastError: null },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: row.branchId,
        actorUserId: principal.userId,
        action: 'notification.retry_requested',
        entityType: 'notification',
        entityId: id,
        before: { status: row.status, attempts: row.attempts },
      });
      return { status: 'PENDING' };
    });
  }
}
