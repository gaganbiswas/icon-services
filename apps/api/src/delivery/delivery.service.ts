import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  Balance,
  Delivery,
  DispatchRequest,
  HandoverRequest,
  Page,
  PaginationQuery,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { branchFilter, hasPermission } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { FilesService } from '../files/files.service.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { JobLifecycleService } from '../jobs/job-lifecycle.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
const q4 = (d: Prisma.Decimal) => d.toFixed(4);

const DELIVERY_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' } },
  job: { select: { jobNumber: true } },
} satisfies Prisma.DeliveryInclude;
type DeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof DELIVERY_INCLUDE }>;

function toDto(r: DeliveryRow): Delivery {
  return {
    id: r.id,
    jobId: r.jobId,
    jobNumber: r.job.jobNumber,
    challanNumber: r.challanNumber,
    mode: r.mode,
    status: r.status,
    address: r.address ?? null,
    recipientName: r.recipientName,
    relationship: r.relationship,
    authorizationNote: r.authorizationNote,
    proofMethod: r.proofMethod,
    items: r.items.map((i) => ({
      description: i.description,
      returned: i.returned,
      condition: i.condition,
    })),
    balance: (r.balanceSnapshot as Balance | null) ?? null,
    dueOverride:
      r.dueOverrideReason && r.dueOverrideById
        ? { reason: r.dueOverrideReason, approvedBy: r.dueOverrideById }
        : null,
    dispatchedAt: r.dispatchedAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    failedReason: r.failedReason,
    createdAt: r.createdAt.toISOString(),
  };
}

const normalize = (s: string) => s.trim().toLowerCase();

@Injectable()
export class DeliveryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly lifecycle: JobLifecycleService,
    private readonly inventory: InventoryService,
    private readonly files: FilesService,
  ) {}

  private async findJob(db: Tx | PrismaClient, principal: Principal, jobId: string) {
    const job = await db.serviceJob.findFirst({
      where: { id: jobId, organizationId: principal.organizationId, ...branchFilter(principal) },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        customerId: true,
        jobNumber: true,
        status: true,
        version: true,
        serviceMode: true,
        serviceAddress: true,
        accessoriesReceived: true,
        asset: { select: { brand: true, model: true, category: { select: { name: true } } } },
      },
    });
    if (!job) throw AppException.notFound('Job');
    return job;
  }

  /** Items that must be handed back: the device plus every accessory recorded at intake. */
  requiredItems(job: {
    accessoriesReceived: string[];
    asset: { brand: string; model: string; category: { name: string } };
  }): string[] {
    return [
      `${job.asset.category.name}: ${job.asset.brand} ${job.asset.model}`,
      ...job.accessoriesReceived,
    ];
  }

  /**
   * Interim balance (ADR 0017): approved current estimate customer-payable minus
   * net payments for the job. Phase 7 replaces this with the invoice balance.
   */
  async balance(db: Tx | PrismaClient, organizationId: string, jobId: string): Promise<Balance> {
    const [current, payments, { currency }] = await Promise.all([
      db.estimate.findFirst({
        where: { jobId, status: { notIn: ['DRAFT', 'WITHDRAWN'] } },
        orderBy: { version: 'desc' },
        select: { status: true, customerPayable: true },
      }),
      db.payment.findMany({
        where: { jobId, organizationId, status: 'RECORDED' },
        select: { amount: true, refundedTotal: true },
      }),
      this.settings.get(organizationId, 'money', db),
    ]);
    const billed = current?.status === 'APPROVED' ? current.customerPayable : new D(0);
    const paid = payments.reduce((acc, p) => acc.plus(p.amount).minus(p.refundedTotal), new D(0));
    const due = Prisma.Decimal.max(billed.minus(paid), new D(0));
    return {
      currency,
      billed: q4(billed),
      paid: q4(paid),
      due: q4(due),
      basis: current?.status === 'APPROVED' ? 'APPROVED_ESTIMATE' : 'NONE',
    };
  }

  async jobDeliveries(
    principal: Principal,
    jobId: string,
  ): Promise<{ deliveries: Delivery[]; balance: Balance; requiredItems: string[] }> {
    const job = await this.findJob(this.prisma, principal, jobId);
    const rows = await this.prisma.delivery.findMany({
      where: { jobId },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return {
      deliveries: rows.map(toDto),
      balance: await this.balance(this.prisma, principal.organizationId, jobId),
      requiredItems: this.requiredItems(job),
    };
  }

  private async challanNumber(tx: Tx, organizationId: string, branchId: string): Promise<string> {
    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: {
        id: true,
        code: true,
        timezone: true,
        organization: { select: { timezone: true } },
      },
    });
    const format = await this.settings.get(organizationId, 'numbering.challanNumber', tx);
    return this.numbering.next(tx, {
      organizationId,
      branch: { id: branch.id, code: branch.code },
      documentType: 'DELIVERY_CHALLAN',
      format,
      timeZone: branch.timezone ?? branch.organization.timezone,
    });
  }

  async dispatch(principal: Principal, jobId: string, input: DispatchRequest): Promise<Delivery> {
    return this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      if (job.version !== input.version) throw AppException.versionConflict();
      if (job.status !== 'READY_FOR_DELIVERY') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'Only jobs ready for delivery can be dispatched',
        );
      }
      const challanNumber = await this.challanNumber(tx, job.organizationId, job.branchId);
      const delivery = await tx.delivery.create({
        data: {
          organizationId: job.organizationId,
          branchId: job.branchId,
          jobId,
          challanNumber,
          mode: input.mode,
          status: 'DISPATCHED',
          address: input.address,
          dispatchedAt: new Date(),
          dispatchedById: principal.userId,
          conditionNotes: input.notes ?? null,
        },
        include: DELIVERY_INCLUDE,
      });
      await this.lifecycle.applyStatusInTx(tx, principal, jobId, 'OUT_FOR_DELIVERY', {
        reason: null,
        customerMessage: null,
        action: 'job.dispatched',
      });
      await this.audit.record(tx, {
        organizationId: job.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'delivery.dispatched',
        entityType: 'delivery',
        entityId: delivery.id,
        after: { jobId, challanNumber, mode: input.mode },
      });
      return toDto(delivery);
    });
  }

  async failedAttempt(principal: Principal, deliveryId: string, reason: string): Promise<Delivery> {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findFirst({
        where: {
          id: deliveryId,
          organizationId: principal.organizationId,
          ...branchFilter(principal),
        },
      });
      if (!delivery) throw AppException.notFound('Delivery');
      const updated = await tx.delivery.updateMany({
        where: { id: deliveryId, status: 'DISPATCHED' },
        data: { status: 'FAILED', failedReason: reason },
      });
      if (updated.count !== 1)
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'Only dispatched deliveries can fail',
        );
      await this.lifecycle.applyStatusInTx(tx, principal, delivery.jobId, 'READY_FOR_DELIVERY', {
        reason,
        customerMessage: null,
        action: 'job.delivery_failed',
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: delivery.branchId,
        actorUserId: principal.userId,
        action: 'delivery.failed',
        entityType: 'delivery',
        entityId: deliveryId,
        reason,
      });
      return toDto(
        await tx.delivery.findUniqueOrThrow({
          where: { id: deliveryId },
          include: DELIVERY_INCLUDE,
        }),
      );
    });
  }

  /** Completes the hand-over: the only way a job becomes DELIVERED (ADR 0017). */
  async handover(
    principal: Principal,
    jobId: string,
    input: HandoverRequest,
    idempotencyKey: string,
  ): Promise<{ status: number; body: Delivery; replayed: boolean }> {
    return this.prisma.$transaction(
      (tx) =>
        runIdempotent<Delivery>(
          tx,
          {
            organizationId: principal.organizationId,
            actorKey: `user:${principal.userId}`,
            operation: 'deliveries.handover',
          },
          idempotencyKey,
          input,
          async () => {
            const job = await this.findJob(tx, principal, jobId);
            if (job.version !== input.version) throw AppException.versionConflict();
            if (job.status !== 'READY_FOR_DELIVERY' && job.status !== 'OUT_FOR_DELIVERY') {
              throw new AppException(
                HttpStatus.CONFLICT,
                'INVALID_TRANSITION',
                'The job is not ready for hand-over',
              );
            }

            // Every intake item must be accounted for (partial delivery disabled).
            const given = new Map(input.items.map((i) => [normalize(i.description), i]));
            const missing = this.requiredItems(job).filter(
              (d) => !given.get(normalize(d))?.returned,
            );
            if (missing.length > 0) {
              throw new AppException(
                HttpStatus.BAD_REQUEST,
                'HANDOVER_INCOMPLETE',
                'Every item received at intake must be returned',
                missing.map((m) => ({ path: 'items', message: `Not confirmed: ${m}` })),
              );
            }
            if (input.proofMethod === 'PHOTO_PROOF' && input.proofFileId) {
              await this.files.assertAttachable(
                principal.organizationId,
                { kind: 'user', userId: principal.userId },
                [input.proofFileId],
              );
            }

            const balance = await this.balance(tx, principal.organizationId, jobId);
            const due = new D(balance.due);
            let override: { reason: string; by: string } | null = null;
            if (due.gt(0)) {
              if (!hasPermission(principal, 'deliveries.due_override')) {
                throw new AppException(
                  HttpStatus.CONFLICT,
                  'BALANCE_DUE',
                  'A balance is due. A manager must approve delivery with a balance due.',
                );
              }
              if (!input.dueOverrideReason) {
                throw new AppException(
                  HttpStatus.BAD_REQUEST,
                  'REASON_REQUIRED',
                  'Give a reason for delivering with a balance due',
                );
              }
              override = { reason: input.dueOverrideReason, by: principal.userId };
            }

            const dispatched = await tx.delivery.findFirst({
              where: { jobId, status: 'DISPATCHED' },
            });
            if (job.status === 'OUT_FOR_DELIVERY' && !dispatched) {
              throw new AppException(
                HttpStatus.CONFLICT,
                'INVALID_TRANSITION',
                'No open dispatch found for this job',
              );
            }
            const mode = dispatched?.mode ?? input.mode;
            if (!mode) {
              throw new AppException(
                HttpStatus.BAD_REQUEST,
                'VALIDATION_FAILED',
                'The request is invalid',
                [{ path: 'mode', message: 'Choose how the device is handed over' }],
              );
            }
            if (!dispatched && mode === 'HOME_DELIVERY') {
              throw new AppException(
                HttpStatus.CONFLICT,
                'INVALID_TRANSITION',
                'Dispatch the job before completing a home delivery',
              );
            }
            const now = new Date();
            const completion = {
              status: 'COMPLETED' as const,
              recipientName: input.recipientName,
              relationship: input.relationship,
              authorizationNote: input.authorizationNote ?? null,
              checklist: input.checklist,
              conditionNotes: input.conditionNotes ?? dispatched?.conditionNotes ?? null,
              proofMethod: input.proofMethod,
              proofFileId: input.proofFileId ?? null,
              balanceSnapshot: balance,
              dueOverrideReason: override?.reason ?? null,
              dueOverrideById: override?.by ?? null,
              deliveredAt: now,
              deliveredById: principal.userId,
            };
            const delivery = dispatched
              ? await tx.delivery.update({ where: { id: dispatched.id }, data: completion })
              : await tx.delivery.create({
                  data: {
                    organizationId: job.organizationId,
                    branchId: job.branchId,
                    jobId,
                    challanNumber: await this.challanNumber(tx, job.organizationId, job.branchId),
                    mode,
                    address:
                      mode === 'ON_SITE_RETURN'
                        ? (job.serviceAddress ?? Prisma.DbNull)
                        : Prisma.DbNull,
                    ...completion,
                  },
                });
            await tx.deliveryItem.createMany({
              data: input.items.map((i) => ({
                deliveryId: delivery.id,
                description: i.description,
                returned: i.returned,
                condition: i.condition ?? null,
              })),
            });

            // Release any part reservations still open on the job.
            const reserved = await tx.jobPart.findMany({ where: { jobId, reserved: { gt: 0 } } });
            for (const part of reserved) {
              await this.inventory.applyMovement(tx, {
                organizationId: job.organizationId,
                branchId: part.branchId,
                partId: part.partId,
                type: 'RELEASE',
                onHandDelta: new D(0),
                reservedDelta: part.reserved.negated(),
                actorUserId: principal.userId,
                allowNegative: false,
                jobId,
                reason: 'Released at delivery',
              });
              await tx.jobPart.update({ where: { id: part.id }, data: { reserved: 0 } });
            }

            await this.lifecycle.applyStatusInTx(tx, principal, jobId, 'DELIVERED', {
              reason: null,
              customerMessage: null,
              action: 'job.delivered',
              event: 'DELIVERY_CONFIRMED',
            });
            await this.audit.record(tx, {
              organizationId: job.organizationId,
              branchId: job.branchId,
              actorUserId: principal.userId,
              action: override ? 'delivery.completed_with_balance_due' : 'delivery.completed',
              entityType: 'delivery',
              entityId: delivery.id,
              after: {
                jobId,
                challanNumber: delivery.challanNumber,
                mode,
                recipient: input.recipientName,
                relationship: input.relationship,
                balance,
              },
              reason: override?.reason ?? null,
            });
            const row = await tx.delivery.findUniqueOrThrow({
              where: { id: delivery.id },
              include: DELIVERY_INCLUDE,
            });
            return { status: 201, body: toDto(row), resourceId: delivery.id };
          },
        ),
      { timeout: 15_000 },
    );
  }

  async register(
    principal: Principal,
    query: PaginationQuery & {
      from?: string | undefined;
      to?: string | undefined;
      branchId?: string | undefined;
    },
  ): Promise<Page<Delivery>> {
    const where: Prisma.DeliveryWhereInput = {
      organizationId: principal.organizationId,
      ...branchFilter(principal),
      ...(query.branchId ? { AND: [{ branchId: query.branchId }] } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: DELIVERY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.delivery.count({ where }),
    ]);
    return { items: rows.map(toDto), page: query.page, pageSize: query.pageSize, total };
  }

  async assertInScope(principal: Principal, deliveryId: string): Promise<void> {
    const count = await this.prisma.delivery.count({
      where: {
        id: deliveryId,
        organizationId: principal.organizationId,
        ...branchFilter(principal),
      },
    });
    if (count !== 1) throw AppException.notFound('Delivery');
  }
}
