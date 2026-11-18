import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CollectionsReport,
  CustomerAccount,
  CustomerPayment,
  Page,
  PaginationQuery,
  Payment,
  PaymentMethod,
  RecordPayment,
  RefundRequest,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { canAccessBranch } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { enqueueNotification } from '../notifications/outbox.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
const q4 = (d: Prisma.Decimal) => d.toFixed(4);
const DAY_MS = 86_400_000;

const PAYMENT_INCLUDE = {
  refunds: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

export function onAccount(p: {
  status: string;
  amount: Prisma.Decimal;
  allocatedTotal: Prisma.Decimal;
  refundedTotal: Prisma.Decimal;
}): Prisma.Decimal {
  return p.status === 'REVERSED'
    ? new D(0)
    : p.amount.minus(p.allocatedTotal).minus(p.refundedTotal);
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
  ) {}

  private scope(principal: Principal): Prisma.PaymentWhereInput {
    return {
      organizationId: principal.organizationId,
      ...(principal.branchAccess === 'ALL'
        ? {}
        : { branchId: { in: [...principal.branchAccess] } }),
    };
  }

  private async toDto(rows: PaymentRow[], db: Tx | PrismaClient = this.prisma): Promise<Payment[]> {
    const [customers, jobs, users] = await Promise.all([
      db.customer.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } },
        select: { id: true, name: true, customerCode: true },
      }),
      db.serviceJob.findMany({
        where: { id: { in: rows.flatMap((r) => (r.jobId ? [r.jobId] : [])) } },
        select: { id: true, jobNumber: true },
      }),
      db.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.receivedById))] } },
        select: { id: true, fullName: true },
      }),
    ]);
    const c = new Map(customers.map((x) => [x.id, x]));
    const j = new Map(jobs.map((x) => [x.id, x.jobNumber]));
    const u = new Map(users.map((x) => [x.id, x]));
    return rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      branchId: r.branchId,
      customer: c.get(r.customerId) ?? { id: r.customerId, name: 'Unknown', customerCode: '' },
      jobId: r.jobId,
      jobNumber: r.jobId ? (j.get(r.jobId) ?? null) : null,
      currency: r.currency,
      amount: q4(r.amount),
      method: r.method,
      reference: r.reference,
      receivedAt: r.receivedAt.toISOString(),
      receivedBy: u.get(r.receivedById) ?? { id: r.receivedById, fullName: 'Unknown' },
      notes: r.notes,
      status: r.status,
      allocated: q4(r.allocatedTotal),
      refunded: q4(r.refundedTotal),
      onAccount: q4(onAccount(r)),
      reversal:
        r.reversedAt && r.reversalReason
          ? { reason: r.reversalReason, at: r.reversedAt.toISOString() }
          : null,
      refunds: r.refunds.map((f) => ({
        id: f.id,
        refundNumber: f.refundNumber,
        amount: q4(f.amount),
        method: f.method,
        reference: f.reference,
        reason: f.reason,
        createdAt: f.createdAt.toISOString(),
      })),
    }));
  }

  private async findPayment(
    db: Tx | PrismaClient,
    principal: Principal,
    id: string,
  ): Promise<PaymentRow> {
    const row = await db.payment.findFirst({
      where: { id, ...this.scope(principal) },
      include: PAYMENT_INCLUDE,
    });
    if (!row) throw AppException.notFound('Payment');
    return row;
  }

  private async currency(organizationId: string, db: Tx): Promise<string> {
    const { currency } = await this.settings.get(organizationId, 'money', db);
    if (!currency) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'CONFIGURATION_REQUIRED',
        'Set the business currency in settings before recording payments',
      );
    }
    return currency;
  }

  private async assertMethodEnabled(
    organizationId: string,
    method: PaymentMethod,
    db: Tx,
  ): Promise<void> {
    const { methods } = await this.settings.get(organizationId, 'payments', db);
    if (!methods.includes(method)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'PAYMENT_METHOD_DISABLED',
        'This payment method is not enabled',
      );
    }
  }

  async record(
    principal: Principal,
    input: RecordPayment,
    idempotencyKey: string,
  ): Promise<{ status: number; body: Payment; replayed: boolean }> {
    if (!canAccessBranch(principal, input.branchId)) throw AppException.notFound('Branch');
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const now = Date.now();
    if (receivedAt.getTime() > now + 60_000 || receivedAt.getTime() < now - 30 * DAY_MS) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The request is invalid',
        [
          {
            path: 'receivedAt',
            message: 'Payment date must be within the last 30 days and not in the future',
          },
        ],
      );
    }
    return this.prisma.$transaction((tx) =>
      runIdempotent<Payment>(
        tx,
        {
          organizationId: principal.organizationId,
          actorKey: `user:${principal.userId}`,
          operation: 'payments.record',
        },
        idempotencyKey,
        input,
        async () => {
          const currency = await this.currency(principal.organizationId, tx);
          await this.assertMethodEnabled(principal.organizationId, input.method, tx);
          const [branch, customer] = await Promise.all([
            tx.branch.findFirst({
              where: {
                id: input.branchId,
                organizationId: principal.organizationId,
                isActive: true,
              },
              select: {
                id: true,
                code: true,
                timezone: true,
                organization: { select: { timezone: true } },
              },
            }),
            tx.customer.findFirst({
              where: {
                id: input.customerId,
                organizationId: principal.organizationId,
                status: 'ACTIVE',
              },
              select: { id: true },
            }),
          ]);
          if (!branch) throw AppException.notFound('Branch');
          if (!customer) throw AppException.notFound('Customer');
          let job: { id: string; jobNumber: string; branchId: string } | null = null;
          if (input.jobId) {
            job = await tx.serviceJob.findFirst({
              where: {
                id: input.jobId,
                organizationId: principal.organizationId,
                customerId: customer.id,
              },
              select: { id: true, jobNumber: true, branchId: true },
            });
            if (!job) throw AppException.notFound('Job');
          }
          const format = await this.settings.get(
            principal.organizationId,
            'numbering.receiptNumber',
            tx,
          );
          const receiptNumber = await this.numbering.next(tx, {
            organizationId: principal.organizationId,
            branch: { id: branch.id, code: branch.code },
            documentType: 'PAYMENT_RECEIPT',
            format,
            timeZone: branch.timezone ?? branch.organization.timezone,
          });
          const created = await tx.payment.create({
            data: {
              organizationId: principal.organizationId,
              branchId: branch.id,
              receiptNumber,
              customerId: customer.id,
              jobId: job?.id ?? null,
              currency,
              amount: input.amount,
              method: input.method,
              reference: input.reference ?? null,
              receivedAt,
              receivedById: principal.userId,
              notes: input.notes ?? null,
            },
            include: PAYMENT_INCLUDE,
          });
          await this.audit.record(tx, {
            organizationId: principal.organizationId,
            branchId: branch.id,
            actorUserId: principal.userId,
            action: 'payment.recorded',
            entityType: 'payment',
            entityId: created.id,
            after: {
              receiptNumber,
              amount: input.amount,
              currency,
              method: input.method,
              customerId: customer.id,
              jobId: job?.id ?? null,
            },
          });
          if (job) {
            await enqueueNotification(tx, {
              organizationId: principal.organizationId,
              branchId: job.branchId,
              jobId: job.id,
              customerId: customer.id,
              eventType: 'PAYMENT_RECEIVED',
              payload: { jobNumber: job.jobNumber, receiptNumber, amount: input.amount, currency },
              dedupeKey: created.id,
            });
          }
          const [dto] = await this.toDto([created], tx);
          return { status: 201, body: dto as Payment, resourceId: created.id };
        },
      ),
    );
  }

  async list(
    principal: Principal,
    query: PaginationQuery & {
      customerId?: string | undefined;
      jobId?: string | undefined;
      branchId?: string | undefined;
    },
  ): Promise<Page<Payment>> {
    const where: Prisma.PaymentWhereInput = {
      ...this.scope(principal),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.jobId ? { jobId: query.jobId } : {}),
      ...(query.branchId ? { AND: [{ branchId: query.branchId }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: await this.toDto(rows), page: query.page, pageSize: query.pageSize, total };
  }

  async get(principal: Principal, id: string): Promise<Payment> {
    const [dto] = await this.toDto([await this.findPayment(this.prisma, principal, id)]);
    return dto as Payment;
  }

  async refund(principal: Principal, id: string, input: RefundRequest): Promise<Payment> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await this.findPayment(tx, principal, id);
      await this.assertMethodEnabled(principal.organizationId, input.method, tx);
      if (payment.status !== 'RECORDED') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'REFUND_EXCEEDS_BALANCE',
          'Reversed payments cannot be refunded',
        );
      }
      // Concurrency-safe: the balance check and increment are one statement.
      const updated = await tx.$executeRaw`
        UPDATE "payments" SET "refunded_total" = "refunded_total" + ${input.amount}::numeric
        WHERE "id" = ${id}::uuid AND "status" = 'RECORDED'
          AND "amount" - "allocated_total" - "refunded_total" >= ${input.amount}::numeric`;
      if (updated !== 1) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'REFUND_EXCEEDS_BALANCE',
          'The refund exceeds the amount available on this payment',
        );
      }
      const branch = await tx.branch.findUniqueOrThrow({
        where: { id: payment.branchId },
        select: {
          id: true,
          code: true,
          timezone: true,
          organization: { select: { timezone: true } },
        },
      });
      const format = await this.settings.get(
        principal.organizationId,
        'numbering.refundNumber',
        tx,
      );
      const refundNumber = await this.numbering.next(tx, {
        organizationId: principal.organizationId,
        branch: { id: branch.id, code: branch.code },
        documentType: 'PAYMENT_REFUND',
        format,
        timeZone: branch.timezone ?? branch.organization.timezone,
      });
      const refund = await tx.paymentRefund.create({
        data: {
          organizationId: principal.organizationId,
          branchId: payment.branchId,
          paymentId: id,
          refundNumber,
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          reason: input.reason,
          approvedById: principal.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: payment.branchId,
        actorUserId: principal.userId,
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: id,
        after: { refundId: refund.id, refundNumber, amount: input.amount, method: input.method },
        reason: input.reason,
      });
    });
    return this.get(principal, id);
  }

  async reverse(principal: Principal, id: string, reason: string): Promise<Payment> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await this.findPayment(tx, principal, id);
      const updated = await tx.payment.updateMany({
        where: { id, status: 'RECORDED', allocatedTotal: 0, refundedTotal: 0 },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedById: principal.userId,
          reversalReason: reason,
        },
      });
      if (updated.count !== 1) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'PAYMENT_NOT_REVERSIBLE',
          'Only payments with nothing refunded or allocated can be reversed',
        );
      }
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: payment.branchId,
        actorUserId: principal.userId,
        action: 'payment.reversed',
        entityType: 'payment',
        entityId: id,
        before: { status: 'RECORDED', amount: q4(payment.amount) },
        after: { status: 'REVERSED' },
        reason,
      });
    });
    return this.get(principal, id);
  }

  async account(principal: Principal, customerId: string): Promise<CustomerAccount> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: principal.organizationId },
      select: { id: true },
    });
    if (!customer) throw AppException.notFound('Customer');
    const rows = await this.prisma.payment.findMany({
      where: { organizationId: principal.organizationId, customerId, status: 'RECORDED' },
      select: { status: true, amount: true, allocatedTotal: true, refundedTotal: true },
    });
    const sum = (f: (r: (typeof rows)[number]) => Prisma.Decimal) =>
      rows.reduce((acc, r) => acc.plus(f(r)), new D(0));
    const { currency } = await this.settings.get(principal.organizationId, 'money');
    return {
      currency,
      received: q4(sum((r) => r.amount)),
      refunded: q4(sum((r) => r.refundedTotal)),
      allocated: q4(sum((r) => r.allocatedTotal)),
      onAccount: q4(sum((r) => onAccount(r))),
      paymentCount: rows.length,
    };
  }

  /** Collections for a period: received by payment date, refunds by refund date; reversed payments excluded. */
  async collections(
    principal: Principal,
    from: Date,
    to: Date,
    branchId?: string,
  ): Promise<CollectionsReport> {
    if (branchId && !canAccessBranch(principal, branchId)) throw AppException.notFound('Branch');
    const branchWhere = branchId
      ? { branchId }
      : principal.branchAccess === 'ALL'
        ? {}
        : { branchId: { in: [...principal.branchAccess] } };
    const [payments, refunds, { currency }] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          organizationId: principal.organizationId,
          ...branchWhere,
          status: 'RECORDED',
          receivedAt: { gte: from, lt: to },
        },
        select: { amount: true, method: true, receivedById: true },
      }),
      this.prisma.paymentRefund.findMany({
        where: {
          organizationId: principal.organizationId,
          ...branchWhere,
          createdAt: { gte: from, lt: to },
        },
        select: { amount: true, method: true },
      }),
      this.settings.get(principal.organizationId, 'money'),
    ]);
    const byMethod = new Map<
      PaymentMethod,
      { received: Prisma.Decimal; refunded: Prisma.Decimal; count: number }
    >();
    const entry = (m: PaymentMethod) => {
      const existing = byMethod.get(m);
      if (existing) return existing;
      const created = { received: new D(0), refunded: new D(0), count: 0 };
      byMethod.set(m, created);
      return created;
    };
    const byCashier = new Map<string, { received: Prisma.Decimal; count: number }>();
    let received = new D(0);
    for (const p of payments) {
      received = received.plus(p.amount);
      const e = entry(p.method);
      e.received = e.received.plus(p.amount);
      e.count += 1;
      const c = byCashier.get(p.receivedById) ?? { received: new D(0), count: 0 };
      c.received = c.received.plus(p.amount);
      c.count += 1;
      byCashier.set(p.receivedById, c);
    }
    let refunded = new D(0);
    for (const r of refunds) {
      refunded = refunded.plus(r.amount);
      const e = entry(r.method);
      e.refunded = e.refunded.plus(r.amount);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byCashier.keys()] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((u) => [u.id, u]));
    return {
      currency,
      from: from.toISOString(),
      to: to.toISOString(),
      received: q4(received),
      refunded: q4(refunded),
      net: q4(received.minus(refunded)),
      byMethod: [...byMethod.entries()].map(([method, v]) => ({
        method,
        received: q4(v.received),
        refunded: q4(v.refunded),
        count: v.count,
      })),
      byCashier: [...byCashier.entries()].map(([id, v]) => ({
        user: names.get(id) ?? { id, fullName: 'Unknown' },
        received: q4(v.received),
        count: v.count,
      })),
    };
  }

  async customerPayments(organizationId: string, customerId: string): Promise<CustomerPayment[]> {
    const rows = await this.prisma.payment.findMany({
      where: { organizationId, customerId },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
    const jobs = await this.prisma.serviceJob.findMany({
      where: { id: { in: rows.flatMap((r) => (r.jobId ? [r.jobId] : [])) } },
      select: { id: true, jobNumber: true },
    });
    const j = new Map(jobs.map((x) => [x.id, x.jobNumber]));
    return rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      jobNumber: r.jobId ? (j.get(r.jobId) ?? null) : null,
      currency: r.currency,
      amount: q4(r.amount),
      method: r.method,
      receivedAt: r.receivedAt.toISOString(),
      status: r.status,
    }));
  }

  async assertCustomerOwns(
    organizationId: string,
    customerId: string,
    paymentId: string,
  ): Promise<void> {
    const count = await this.prisma.payment.count({
      where: { id: paymentId, organizationId, customerId },
    });
    if (count !== 1) throw AppException.notFound('Payment');
  }
}
