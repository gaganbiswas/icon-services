import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreatePart,
  JobPart,
  JobPartAction,
  Page,
  PaginationQuery,
  Part,
  StockLevel,
  StockMovement,
  StockMovementType,
  Supplier,
  UpdatePart,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { canAccessBranch, hasPermission } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { PRISMA } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
const q4 = (d: Prisma.Decimal) => d.toFixed(4);

const RESERVE_STATUSES = new Set([
  'RECEIVED',
  'WARRANTY_CHECK',
  'DIAGNOSIS',
  'ESTIMATE_PREPARATION',
  'AWAITING_CUSTOMER_APPROVAL',
  'WAITING_FOR_PARTS',
  'REPAIR_IN_PROGRESS',
  'QUALITY_CHECK',
  'ON_HOLD',
]);
const CONSUME_STATUSES = new Set(['WAITING_FOR_PARTS', 'REPAIR_IN_PROGRESS', 'QUALITY_CHECK']);

interface MovementInput {
  readonly organizationId: string;
  readonly branchId: string;
  readonly partId: string;
  readonly type: StockMovementType;
  readonly onHandDelta: Prisma.Decimal;
  readonly reservedDelta: Prisma.Decimal;
  readonly actorUserId: string;
  readonly allowNegative: boolean;
  readonly unitCost?: string | undefined;
  readonly supplierId?: string | undefined;
  readonly jobId?: string | undefined;
  readonly transferId?: string | undefined;
  readonly reference?: string | undefined;
  readonly reason?: string | undefined;
}

function insufficient(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    'INSUFFICIENT_STOCK',
    'Not enough stock available for this part in this branch',
  );
}

type PartRow = Prisma.PartGetPayload<object>;

export function toPartDto(p: PartRow): Part {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    unit: p.unit,
    reorderLevel: q4(p.reorderLevel),
    sellingPrice: p.sellingPrice ? q4(p.sellingPrice) : null,
    isActive: p.isActive,
    version: p.version,
  };
}

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- ledger

  /**
   * The only way stock changes (ADR 0015): one conditional UPDATE (no
   * oversell under concurrency) plus its ledger row, in the caller's transaction.
   */
  async applyMovement(tx: Tx, m: MovementInput): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "branch_stock" ("id", "organization_id", "branch_id", "part_id", "on_hand", "reserved", "updated_at")
      VALUES (gen_random_uuid(), ${m.organizationId}::uuid, ${m.branchId}::uuid, ${m.partId}::uuid, 0, 0, now())
      ON CONFLICT ("branch_id", "part_id") DO NOTHING`;
    // Availability change = on-hand change minus reservation change.
    const availabilityDelta = m.onHandDelta.minus(m.reservedDelta);
    const checkAvailability = availabilityDelta.isNegative() && !m.allowNegative;
    const rows = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
      UPDATE "branch_stock" SET
        "on_hand" = "on_hand" + ${m.onHandDelta.toFixed(4)}::numeric,
        "reserved" = "reserved" + ${m.reservedDelta.toFixed(4)}::numeric,
        "updated_at" = now()
      WHERE "branch_id" = ${m.branchId}::uuid AND "part_id" = ${m.partId}::uuid
        AND "reserved" + ${m.reservedDelta.toFixed(4)}::numeric >= 0
        AND (${!checkAvailability} OR "on_hand" - "reserved" + ${availabilityDelta.toFixed(4)}::numeric >= 0)
      RETURNING "on_hand"`;
    if (rows.length !== 1) throw insufficient();
    const negativeOverride = m.allowNegative && new D(rows[0]?.on_hand ?? 0).isNegative();
    await tx.stockMovement.create({
      data: {
        organizationId: m.organizationId,
        branchId: m.branchId,
        partId: m.partId,
        type: m.type,
        onHandDelta: m.onHandDelta,
        reservedDelta: m.reservedDelta,
        unitCost: m.unitCost ?? null,
        supplierId: m.supplierId ?? null,
        jobId: m.jobId ?? null,
        transferId: m.transferId ?? null,
        reference: m.reference ?? null,
        reason: m.reason ?? null,
        negativeOverride,
        actorUserId: m.actorUserId,
      },
    });
  }

  private assertOverride(
    principal: Principal,
    allowNegative: boolean,
    reason: string | undefined,
  ): void {
    if (!allowNegative) return;
    if (!hasPermission(principal, 'inventory.negative_override')) {
      throw AppException.forbidden('You cannot allow stock to go negative');
    }
    if (!reason) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'REASON_REQUIRED',
        'A reason is required to allow negative stock',
      );
    }
  }

  private assertBranch(principal: Principal, branchId: string): void {
    if (!canAccessBranch(principal, branchId)) throw AppException.notFound('Branch');
  }

  private async findPart(
    db: Tx | PrismaClient,
    organizationId: string,
    partId: string,
    activeOnly = true,
  ): Promise<PartRow> {
    const part = await db.part.findFirst({
      where: { id: partId, organizationId, ...(activeOnly ? { isActive: true } : {}) },
    });
    if (!part) throw AppException.notFound('Part');
    return part;
  }

  private async assertBranchInOrg(db: Tx, organizationId: string, branchId: string): Promise<void> {
    const count = await db.branch.count({
      where: { id: branchId, organizationId, isActive: true },
    });
    if (count !== 1) throw AppException.notFound('Branch');
  }

  // ---------------------------------------------------------- catalogue

  async searchParts(
    principal: Principal,
    q: string | undefined,
    includeInactive: boolean,
  ): Promise<Part[]> {
    const rows = await this.prisma.part.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { sku: { contains: q.toUpperCase() } },
                { name: { contains: q, mode: 'insensitive' } },
                { category: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { sku: 'asc' },
      take: 100,
    });
    return rows.map(toPartDto);
  }

  async createPart(principal: Principal, input: CreatePart): Promise<Part> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const part = await tx.part.create({
          data: {
            organizationId: principal.organizationId,
            sku: input.sku,
            name: input.name,
            description: input.description ?? null,
            category: input.category ?? null,
            unit: input.unit,
            reorderLevel: input.reorderLevel,
            sellingPrice: input.sellingPrice ?? null,
          },
        });
        await this.audit.record(tx, {
          organizationId: principal.organizationId,
          actorUserId: principal.userId,
          action: 'part.created',
          entityType: 'part',
          entityId: part.id,
          after: toPartDto(part),
        });
        return toPartDto(part);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict('A part with this SKU already exists');
      }
      throw error;
    }
  }

  async updatePart(principal: Principal, id: string, input: UpdatePart): Promise<Part> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findPart(tx, principal.organizationId, id, false);
      const updated = await tx.part.updateMany({
        where: { id, organizationId: principal.organizationId, version: input.version },
        data: {
          version: { increment: 1 },
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description ?? null } : {}),
          ...(input.category !== undefined ? { category: input.category ?? null } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
          ...(input.sellingPrice !== undefined ? { sellingPrice: input.sellingPrice } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      if (updated.count !== 1) throw AppException.versionConflict();
      const after = await tx.part.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'part.updated',
        entityType: 'part',
        entityId: id,
        before: toPartDto(before),
        after: toPartDto(after),
      });
      return toPartDto(after);
    });
  }

  async suppliers(principal: Principal): Promise<Supplier[]> {
    return this.prisma.supplier.findMany({
      where: { organizationId: principal.organizationId },
      select: { id: true, name: true, phone: true, email: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSupplier(
    principal: Principal,
    input: {
      name: string;
      phone?: string | undefined;
      email?: string | undefined;
      notes?: string | undefined;
    },
  ): Promise<Supplier> {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          organizationId: principal.organizationId,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          notes: input.notes ?? null,
        },
        select: { id: true, name: true, phone: true, email: true, isActive: true },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: supplier.id,
        after: supplier,
      });
      return supplier;
    });
  }

  // -------------------------------------------------------------- stock

  async stockLevels(
    principal: Principal,
    branchId: string,
    belowReorderOnly: boolean,
    q?: string,
  ): Promise<StockLevel[]> {
    this.assertBranch(principal, branchId);
    const parts = await this.prisma.part.findMany({
      where: {
        organizationId: principal.organizationId,
        isActive: true,
        ...(q
          ? {
              OR: [
                { sku: { contains: q.toUpperCase() } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { stock: { where: { branchId } } },
      orderBy: { sku: 'asc' },
      take: 500,
    });
    const levels = parts.map((part) => {
      const stock = part.stock[0];
      const onHand = stock?.onHand ?? new D(0);
      const reserved = stock?.reserved ?? new D(0);
      const available = onHand.minus(reserved);
      const reorderLevel = stock?.reorderLevel ?? part.reorderLevel;
      return {
        part: toPartDto(part),
        branchId,
        onHand: q4(onHand),
        reserved: q4(reserved),
        available: q4(available),
        reorderLevel: q4(reorderLevel),
        belowReorder: available.lte(reorderLevel),
      };
    });
    return belowReorderOnly ? levels.filter((l) => l.belowReorder) : levels;
  }

  async receive(
    principal: Principal,
    input: {
      branchId: string;
      partId: string;
      quantity: string;
      unitCost?: string | undefined;
      supplierId?: string | undefined;
      reference?: string | undefined;
    },
  ): Promise<StockLevel> {
    this.assertBranch(principal, input.branchId);
    await this.prisma.$transaction(async (tx) => {
      await this.assertBranchInOrg(tx, principal.organizationId, input.branchId);
      await this.findPart(tx, principal.organizationId, input.partId);
      if (input.supplierId) {
        const ok = await tx.supplier.count({
          where: { id: input.supplierId, organizationId: principal.organizationId },
        });
        if (ok !== 1) throw AppException.notFound('Supplier');
      }
      await this.applyMovement(tx, {
        organizationId: principal.organizationId,
        branchId: input.branchId,
        partId: input.partId,
        type: 'RECEIVE',
        onHandDelta: new D(input.quantity),
        reservedDelta: new D(0),
        actorUserId: principal.userId,
        allowNegative: false,
        unitCost: input.unitCost,
        supplierId: input.supplierId,
        reference: input.reference,
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: input.branchId,
        actorUserId: principal.userId,
        action: 'stock.received',
        entityType: 'part',
        entityId: input.partId,
        after: {
          quantity: input.quantity,
          unitCost: input.unitCost ?? null,
          supplierId: input.supplierId ?? null,
        },
      });
    });
    return this.level(principal, input.branchId, input.partId);
  }

  async adjust(
    principal: Principal,
    input: {
      branchId: string;
      partId: string;
      direction: 'INCREASE' | 'DECREASE';
      quantity: string;
      reason: string;
      allowNegative: boolean;
    },
  ): Promise<StockLevel> {
    this.assertBranch(principal, input.branchId);
    this.assertOverride(principal, input.allowNegative, input.reason);
    await this.prisma.$transaction(async (tx) => {
      await this.assertBranchInOrg(tx, principal.organizationId, input.branchId);
      await this.findPart(tx, principal.organizationId, input.partId, false);
      const qty = new D(input.quantity);
      await this.applyMovement(tx, {
        organizationId: principal.organizationId,
        branchId: input.branchId,
        partId: input.partId,
        type: 'ADJUST',
        onHandDelta: input.direction === 'INCREASE' ? qty : qty.negated(),
        reservedDelta: new D(0),
        actorUserId: principal.userId,
        allowNegative: input.allowNegative,
        reason: input.reason,
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: input.branchId,
        actorUserId: principal.userId,
        action: input.allowNegative ? 'stock.adjusted_with_override' : 'stock.adjusted',
        entityType: 'part',
        entityId: input.partId,
        after: { direction: input.direction, quantity: input.quantity },
        reason: input.reason,
      });
    });
    return this.level(principal, input.branchId, input.partId);
  }

  async transfer(
    principal: Principal,
    input: {
      fromBranchId: string;
      toBranchId: string;
      partId: string;
      quantity: string;
      reason?: string | undefined;
    },
  ): Promise<{ from: StockLevel; to: StockLevel }> {
    this.assertBranch(principal, input.fromBranchId);
    this.assertBranch(principal, input.toBranchId);
    await this.prisma.$transaction(async (tx) => {
      await this.assertBranchInOrg(tx, principal.organizationId, input.fromBranchId);
      await this.assertBranchInOrg(tx, principal.organizationId, input.toBranchId);
      await this.findPart(tx, principal.organizationId, input.partId);
      const qty = new D(input.quantity);
      const transferId = randomUUID();
      const common = {
        organizationId: principal.organizationId,
        partId: input.partId,
        reservedDelta: new D(0),
        actorUserId: principal.userId,
        allowNegative: false,
        transferId,
        reason: input.reason,
      };
      await this.applyMovement(tx, {
        ...common,
        branchId: input.fromBranchId,
        type: 'TRANSFER_OUT',
        onHandDelta: qty.negated(),
      });
      await this.applyMovement(tx, {
        ...common,
        branchId: input.toBranchId,
        type: 'TRANSFER_IN',
        onHandDelta: qty,
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: input.fromBranchId,
        actorUserId: principal.userId,
        action: 'stock.transferred',
        entityType: 'part',
        entityId: input.partId,
        after: {
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          quantity: input.quantity,
          transferId,
        },
        reason: input.reason ?? null,
      });
    });
    return {
      from: await this.level(principal, input.fromBranchId, input.partId),
      to: await this.level(principal, input.toBranchId, input.partId),
    };
  }

  async movements(
    principal: Principal,
    query: PaginationQuery & {
      branchId?: string | undefined;
      partId?: string | undefined;
      jobId?: string | undefined;
    },
  ): Promise<Page<StockMovement>> {
    if (query.branchId) this.assertBranch(principal, query.branchId);
    const where: Prisma.StockMovementWhereInput = {
      organizationId: principal.organizationId,
      ...(principal.branchAccess === 'ALL'
        ? {}
        : { branchId: { in: [...principal.branchAccess] } }),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.partId ? { partId: query.partId } : {}),
      ...(query.jobId ? { jobId: query.jobId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorUserId))] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(actors.map((a) => [a.id, a]));
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        branchId: r.branchId,
        partId: r.partId,
        onHandDelta: q4(r.onHandDelta),
        reservedDelta: q4(r.reservedDelta),
        unitCost: r.unitCost ? q4(r.unitCost) : null,
        jobId: r.jobId,
        reason: r.reason,
        negativeOverride: r.negativeOverride,
        actor: names.get(r.actorUserId) ?? { id: r.actorUserId, fullName: 'Unknown' },
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Stock rows whose totals differ from the ledger. Must always be empty. */
  async reconciliation(
    principal: Principal,
    branchId: string,
  ): Promise<
    {
      partId: string;
      onHand: string;
      ledgerOnHand: string;
      reserved: string;
      ledgerReserved: string;
    }[]
  > {
    this.assertBranch(principal, branchId);
    const rows = await this.prisma.$queryRaw<
      {
        part_id: string;
        on_hand: Prisma.Decimal;
        ledger_on_hand: Prisma.Decimal;
        reserved: Prisma.Decimal;
        ledger_reserved: Prisma.Decimal;
      }[]
    >`
      SELECT s."part_id", s."on_hand", COALESCE(SUM(m."on_hand_delta"), 0) AS ledger_on_hand,
             s."reserved", COALESCE(SUM(m."reserved_delta"), 0) AS ledger_reserved
      FROM "branch_stock" s
      LEFT JOIN "stock_movements" m ON m."branch_id" = s."branch_id" AND m."part_id" = s."part_id"
      WHERE s."branch_id" = ${branchId}::uuid AND s."organization_id" = ${principal.organizationId}::uuid
      GROUP BY s."part_id", s."on_hand", s."reserved"
      HAVING s."on_hand" <> COALESCE(SUM(m."on_hand_delta"), 0) OR s."reserved" <> COALESCE(SUM(m."reserved_delta"), 0)`;
    return rows.map((r) => ({
      partId: r.part_id,
      onHand: q4(new D(r.on_hand)),
      ledgerOnHand: q4(new D(r.ledger_on_hand)),
      reserved: q4(new D(r.reserved)),
      ledgerReserved: q4(new D(r.ledger_reserved)),
    }));
  }

  private async level(principal: Principal, branchId: string, partId: string): Promise<StockLevel> {
    const part = await this.findPart(this.prisma, principal.organizationId, partId, false);
    const stock = await this.prisma.branchStock.findUnique({
      where: { branchId_partId: { branchId, partId } },
    });
    const onHand = stock?.onHand ?? new D(0);
    const reserved = stock?.reserved ?? new D(0);
    const reorderLevel = stock?.reorderLevel ?? part.reorderLevel;
    return {
      part: toPartDto(part),
      branchId,
      onHand: q4(onHand),
      reserved: q4(reserved),
      available: q4(onHand.minus(reserved)),
      reorderLevel: q4(reorderLevel),
      belowReorder: onHand.minus(reserved).lte(reorderLevel),
    };
  }

  // ----------------------------------------------------------- job parts

  private async workJob(tx: Tx, principal: Principal, jobId: string) {
    const job = await tx.serviceJob.findFirst({
      where: {
        id: jobId,
        organizationId: principal.organizationId,
        ...(principal.branchAccess === 'ALL'
          ? {}
          : { branchId: { in: [...principal.branchAccess] } }),
      },
      select: { id: true, branchId: true, status: true },
    });
    if (!job) throw AppException.notFound('Job');
    if (!hasPermission(principal, 'jobs.assign')) {
      const assigned = await tx.jobAssignment.count({
        where: { jobId, technicianUserId: principal.userId, endedAt: null },
      });
      if (assigned === 0)
        throw new AppException(
          HttpStatus.FORBIDDEN,
          'NOT_ASSIGNED',
          'This job is not assigned to you',
        );
    }
    return job;
  }

  async jobParts(principal: Principal, jobId: string): Promise<JobPart[]> {
    const job = await this.prisma.serviceJob.findFirst({
      where: {
        id: jobId,
        organizationId: principal.organizationId,
        ...(principal.branchAccess === 'ALL'
          ? {}
          : { branchId: { in: [...principal.branchAccess] } }),
      },
      select: { id: true },
    });
    if (!job) throw AppException.notFound('Job');
    const rows = await this.prisma.jobPart.findMany({
      where: { jobId },
      include: { part: { select: { id: true, sku: true, name: true, unit: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      part: r.part,
      reserved: q4(r.reserved),
      consumed: q4(r.consumed),
      returned: q4(r.returned),
      removedPartDescription: r.removedPartDescription,
      removedPartSerial: r.removedPartSerial,
      disposition: r.disposition,
    }));
  }

  async jobPartAction(
    principal: Principal,
    jobId: string,
    input: JobPartAction,
  ): Promise<JobPart[]> {
    this.assertOverride(principal, input.allowNegative, input.reason);
    await this.prisma.$transaction(async (tx) => {
      const job = await this.workJob(tx, principal, jobId);
      const allowed =
        input.action === 'RELEASE'
          ? true
          : input.action === 'RESERVE'
            ? RESERVE_STATUSES.has(job.status)
            : CONSUME_STATUSES.has(job.status);
      if (!allowed) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          `Parts cannot be ${input.action.toLowerCase()}d at the job's current status`,
        );
      }
      await this.findPart(
        tx,
        principal.organizationId,
        input.partId,
        input.action === 'RESERVE' || input.action === 'CONSUME',
      );
      // Concurrency-safe create, then lock the row so quantity checks see current values.
      await tx.$executeRaw`
        INSERT INTO "job_parts" ("id", "job_id", "organization_id", "branch_id", "part_id", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${jobId}::uuid, ${principal.organizationId}::uuid, ${job.branchId}::uuid, ${input.partId}::uuid, now(), now())
        ON CONFLICT ("job_id", "part_id") DO NOTHING`;
      await tx.$queryRaw`SELECT "id" FROM "job_parts" WHERE "job_id" = ${jobId}::uuid AND "part_id" = ${input.partId}::uuid FOR UPDATE`;
      const row = await tx.jobPart.findUniqueOrThrow({
        where: { jobId_partId: { jobId, partId: input.partId } },
      });
      const qty = new D(input.quantity);
      const zero = new D(0);
      let onHandDelta = zero;
      let reservedDelta = zero;
      const change: Prisma.JobPartUpdateInput = {};
      switch (input.action) {
        case 'RESERVE':
          reservedDelta = qty;
          change.reserved = { increment: qty };
          break;
        case 'RELEASE':
          if (qty.gt(row.reserved))
            throw AppException.conflict('Cannot release more than is reserved for this job');
          reservedDelta = qty.negated();
          change.reserved = { decrement: qty };
          break;
        case 'CONSUME': {
          // Use this job's reservation first, then free stock.
          const fromReservation = Prisma.Decimal.min(qty, row.reserved);
          onHandDelta = qty.negated();
          reservedDelta = fromReservation.negated();
          change.reserved = { decrement: fromReservation };
          change.consumed = { increment: qty };
          break;
        }
        case 'RETURN':
          if (qty.gt(row.consumed.minus(row.returned)))
            throw AppException.conflict('Cannot return more than was used on this job');
          onHandDelta = qty;
          change.returned = { increment: qty };
          break;
      }
      await this.applyMovement(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        partId: input.partId,
        type: input.action,
        onHandDelta,
        reservedDelta,
        actorUserId: principal.userId,
        allowNegative: input.allowNegative,
        jobId,
        reason: input.reason,
      });
      await tx.jobPart.update({ where: { id: row.id }, data: change });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: `job.part_${input.action.toLowerCase()}`,
        entityType: 'service_job',
        entityId: jobId,
        after: {
          partId: input.partId,
          quantity: input.quantity,
          negativeOverride: input.allowNegative,
        },
        reason: input.reason ?? null,
      });
    });
    return this.jobParts(principal, jobId);
  }

  async recordRemovedPart(
    principal: Principal,
    jobId: string,
    input: {
      partId: string;
      removedPartDescription: string;
      removedPartSerial?: string | undefined;
      disposition: JobPart['disposition'];
    },
  ): Promise<JobPart[]> {
    await this.prisma.$transaction(async (tx) => {
      const job = await this.workJob(tx, principal, jobId);
      const row = await tx.jobPart.findUnique({
        where: { jobId_partId: { jobId, partId: input.partId } },
      });
      if (!row || row.consumed.lte(0))
        throw AppException.conflict(
          'Record the replacement part as used before describing the removed part',
        );
      await tx.jobPart.update({
        where: { id: row.id },
        data: {
          removedPartDescription: input.removedPartDescription,
          removedPartSerial: input.removedPartSerial ?? null,
          disposition: input.disposition,
        },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'job.removed_part_recorded',
        entityType: 'service_job',
        entityId: jobId,
        after: {
          partId: input.partId,
          disposition: input.disposition,
          serial: input.removedPartSerial ?? null,
        },
      });
    });
    return this.jobParts(principal, jobId);
  }
}
