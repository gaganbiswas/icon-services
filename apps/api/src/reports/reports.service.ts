import { Inject, Injectable } from '@nestjs/common';
import {
  AGING_BUCKETS,
  type Dashboard,
  type JobRegisterQuery,
  type JobRegisterRow,
  type OutstandingReport,
  type Page,
  type PartsReport,
  type TechnicianPerformanceRow,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { canAccessBranch } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AppException } from '../common/app-exception.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Jobs whose repair is finished (used for overdue and outstanding rules). */
const FINISHED = [
  'REPAIR_COMPLETED',
  'READY_FOR_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;
const CLOSED = [...FINISHED, 'CANCELLED'] as const;

/** Prisma's decimal.js build; never JS floating point for money (ADR 0005). */
const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const money = (value: Prisma.Decimal | string | null | undefined) =>
  new Decimal(value?.toString() ?? '0').toFixed(4);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Read-only reports (CLAUDE.md §4.12, ADR 0019). Every query is scoped to the
 * caller's organization and permitted branches; nothing here mutates data.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
  ) {}

  /** Branch IDs the query may read, or null for every branch of the organization. */
  scope(principal: Principal, branchId?: string): string[] | null {
    if (branchId) {
      if (!canAccessBranch(principal, branchId)) throw AppException.notFound('Branch');
      return [branchId];
    }
    return principal.branchAccess === 'ALL' ? null : [...principal.branchAccess];
  }

  private branchSql(column: Prisma.Sql, branches: string[] | null): Prisma.Sql {
    return branches === null ? Prisma.sql`TRUE` : Prisma.sql`${column} = ANY(${branches}::uuid[])`;
  }

  async timezone(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return org?.timezone ?? 'UTC';
  }

  async organizationName(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { displayName: true },
    });
    return org?.displayName ?? '';
  }

  async dashboard(principal: Principal, branchId?: string): Promise<Dashboard> {
    const org = principal.organizationId;
    const branches = this.scope(principal, branchId);
    const tz = await this.timezone(org);
    const inJobs = this.branchSql(Prisma.sql`j.branch_id`, branches);
    const [byStatus, counts, collected, workload, mix, outstanding, { currency }] =
      await Promise.all([
        this.prisma.$queryRaw<
          { status: Dashboard['jobsByStatus'][number]['status']; count: number }[]
        >`
        SELECT j.status::text AS status, count(*)::int AS count FROM service_jobs j
        WHERE j.organization_id = ${org}::uuid AND ${inJobs} GROUP BY j.status ORDER BY j.status`,
        this.prisma.$queryRaw<{ new_today: number; overdue: number }[]>`
        SELECT
          count(*) FILTER (WHERE j.created_at >= (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}))::int AS new_today,
          count(*) FILTER (WHERE j.expected_completion_date < (now() AT TIME ZONE ${tz})::date
                             AND j.status::text <> ALL(${[...CLOSED]}::text[]))::int AS overdue
        FROM service_jobs j WHERE j.organization_id = ${org}::uuid AND ${inJobs}`,
        this.prisma.$queryRaw<{ today: Prisma.Decimal | null; month: Prisma.Decimal | null }[]>`
        WITH bounds AS (
          SELECT date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz} AS day_start,
                 date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz} AS month_start),
        movements AS (
          SELECT p.received_at AS at, p.amount AS amount FROM payments p
          WHERE p.organization_id = ${org}::uuid AND p.status = 'RECORDED' AND ${this.branchSql(Prisma.sql`p.branch_id`, branches)}
          UNION ALL
          SELECT r.created_at, -r.amount FROM payment_refunds r
          WHERE r.organization_id = ${org}::uuid AND ${this.branchSql(Prisma.sql`r.branch_id`, branches)})
        SELECT sum(m.amount) FILTER (WHERE m.at >= b.day_start) AS today,
               sum(m.amount) FILTER (WHERE m.at >= b.month_start) AS month
        FROM movements m CROSS JOIN bounds b WHERE m.at >= b.month_start`,
        this.prisma.$queryRaw<{ id: string; full_name: string; open_jobs: number }[]>`
        SELECT u.id, u.full_name, count(*)::int AS open_jobs
        FROM job_assignments a JOIN service_jobs j ON j.id = a.job_id JOIN users u ON u.id = a.technician_user_id
        WHERE j.organization_id = ${org}::uuid AND ${inJobs} AND a.ended_at IS NULL
          AND j.status::text <> ALL(${[...CLOSED]}::text[])
        GROUP BY u.id, u.full_name ORDER BY open_jobs DESC, u.full_name`,
        this.prisma.$queryRaw<{ service_type: string; count: number }[]>`
        SELECT j.service_type::text AS service_type, count(*)::int AS count FROM service_jobs j
        WHERE j.organization_id = ${org}::uuid AND ${inJobs} AND j.created_at >= now() - interval '30 days'
        GROUP BY j.service_type ORDER BY j.service_type`,
        this.outstandingRows(org, branches),
        this.settings.get(org, 'money'),
      ]);
    const count = (status: string) => byStatus.find((s) => s.status === status)?.count ?? 0;
    return {
      generatedAt: new Date().toISOString(),
      timezone: tz,
      currency,
      newJobsToday: counts[0]?.new_today ?? 0,
      jobsByStatus: byStatus,
      overdueJobs: counts[0]?.overdue ?? 0,
      awaitingApproval: count('AWAITING_CUSTOMER_APPROVAL'),
      waitingForParts: count('WAITING_FOR_PARTS'),
      repairCompleted: count('REPAIR_COMPLETED'),
      readyForDelivery: count('READY_FOR_DELIVERY'),
      collectedToday: money(collected[0]?.today),
      collectedThisMonth: money(collected[0]?.month),
      outstanding: {
        total: outstanding
          .reduce((sum, r) => sum.plus(r.due.toString()), new Decimal(0))
          .toFixed(4),
        jobs: outstanding.length,
      },
      technicianWorkload: workload.map((w) => ({
        user: { id: w.id, fullName: w.full_name },
        openJobs: w.open_jobs,
      })),
      warrantyMix: mix.map((m) => ({ serviceType: m.service_type, count: m.count })),
    };
  }

  async jobRegister(
    principal: Principal,
    q: JobRegisterQuery,
    limit?: number,
  ): Promise<Page<JobRegisterRow>> {
    const org = principal.organizationId;
    const branches = this.scope(principal, q.branchId);
    const where = Prisma.sql`
      j.organization_id = ${org}::uuid AND ${this.branchSql(Prisma.sql`j.branch_id`, branches)}
      AND j.created_at >= ${new Date(q.from)} AND j.created_at < ${new Date(q.to)}
      ${q.status ? Prisma.sql`AND j.status::text = ${q.status}` : Prisma.empty}
      ${q.serviceType ? Prisma.sql`AND j.service_type::text = ${q.serviceType}` : Prisma.empty}
      ${q.categoryId ? Prisma.sql`AND a.category_id = ${q.categoryId}::uuid` : Prisma.empty}
      ${q.technicianId ? Prisma.sql`AND EXISTS (SELECT 1 FROM job_assignments x WHERE x.job_id = j.id AND x.technician_user_id = ${q.technicianId}::uuid)` : Prisma.empty}`;
    const take = limit ?? q.pageSize;
    const skip = limit ? 0 : (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          job_number: string;
          branch_code: string;
          received_at: Date;
          customer_name: string;
          category: string;
          brand: string;
          model: string;
          serial_number: string | null;
          service_type: string;
          status: JobRegisterRow['status'];
          technicians: string | null;
          expected_completion_date: Date | null;
          completed_at: Date | null;
          delivered_at: Date | null;
        }[]
      >`
        SELECT j.id, j.job_number, b.code AS branch_code, coalesce(j.received_at, j.created_at) AS received_at,
               c.name AS customer_name, cat.name AS category, a.brand, a.model, a.serial_number,
               j.service_type::text AS service_type, j.status::text AS status,
               (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name) FROM job_assignments x JOIN users u ON u.id = x.technician_user_id
                 WHERE x.job_id = j.id AND x.ended_at IS NULL) AS technicians,
               j.expected_completion_date, j.completed_at,
               (SELECT max(d.delivered_at) FROM deliveries d WHERE d.job_id = j.id AND d.status = 'COMPLETED') AS delivered_at
        FROM service_jobs j
        JOIN branches b ON b.id = j.branch_id
        JOIN customers c ON c.id = j.customer_id
        JOIN assets a ON a.id = j.asset_id
        JOIN asset_categories cat ON cat.id = a.category_id
        WHERE ${where}
        ORDER BY j.created_at DESC, j.id
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM service_jobs j JOIN assets a ON a.id = j.asset_id WHERE ${where}`,
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        jobNumber: r.job_number,
        branchCode: r.branch_code,
        receivedAt: r.received_at.toISOString(),
        customerName: r.customer_name,
        category: r.category,
        device: `${r.brand} ${r.model}`,
        serialNumber: r.serial_number,
        serviceType: r.service_type,
        status: r.status,
        technicians: r.technicians ?? '',
        expectedCompletionDate: r.expected_completion_date
          ? r.expected_completion_date.toISOString().slice(0, 10)
          : null,
        completedAt: iso(r.completed_at),
        deliveredAt: iso(r.delivered_at),
      })),
      total: total[0]?.total ?? 0,
      page: limit ? 1 : q.page,
      pageSize: take,
    };
  }

  async technicians(
    principal: Principal,
    from: Date,
    to: Date,
    branchId?: string,
  ): Promise<TechnicianPerformanceRow[]> {
    const org = principal.organizationId;
    const inJobs = this.branchSql(Prisma.sql`j.branch_id`, this.scope(principal, branchId));
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        full_name: string;
        open_jobs: number;
        completed_jobs: number;
        avg_hours: Prisma.Decimal | null;
        median_hours: number | null;
      }[]
    >`
      WITH open AS (
        SELECT a.technician_user_id AS user_id, count(DISTINCT j.id)::int AS open_jobs
        FROM job_assignments a JOIN service_jobs j ON j.id = a.job_id
        WHERE j.organization_id = ${org}::uuid AND ${inJobs} AND a.ended_at IS NULL AND j.status::text <> ALL(${[...CLOSED]}::text[])
        GROUP BY a.technician_user_id),
      done AS (
        SELECT j.completed_by_id AS user_id, count(*)::int AS completed_jobs,
               avg(extract(epoch FROM (j.completed_at - coalesce(j.received_at, j.created_at))) / 3600)::numeric AS avg_hours,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (j.completed_at - coalesce(j.received_at, j.created_at))) / 3600) AS median_hours
        FROM service_jobs j
        WHERE j.organization_id = ${org}::uuid AND ${inJobs} AND j.completed_by_id IS NOT NULL
          AND j.completed_at >= ${from} AND j.completed_at < ${to}
        GROUP BY j.completed_by_id)
      SELECT u.id, u.full_name, coalesce(o.open_jobs, 0) AS open_jobs, coalesce(d.completed_jobs, 0) AS completed_jobs, d.avg_hours, d.median_hours
      FROM users u LEFT JOIN open o ON o.user_id = u.id LEFT JOIN done d ON d.user_id = u.id
      WHERE u.organization_id = ${org}::uuid AND (o.user_id IS NOT NULL OR d.user_id IS NOT NULL)
      ORDER BY completed_jobs DESC, u.full_name`;
    return rows.map((r) => ({
      user: { id: r.id, fullName: r.full_name },
      openJobs: r.open_jobs,
      completedJobs: r.completed_jobs,
      averageTurnaroundHours:
        r.avg_hours === null ? null : new Decimal(r.avg_hours.toString()).toFixed(1),
      medianTurnaroundHours:
        r.median_hours === null ? null : new Decimal(r.median_hours).toFixed(1),
    }));
  }

  async parts(principal: Principal, from: Date, to: Date, branchId?: string): Promise<PartsReport> {
    const org = principal.organizationId;
    const branches = this.scope(principal, branchId);
    const [usage, valuation] = await Promise.all([
      this.prisma.$queryRaw<
        {
          part_id: string;
          sku: string;
          name: string;
          unit: string;
          consumed: Prisma.Decimal;
          returned: Prisma.Decimal;
        }[]
      >`
        SELECT p.id AS part_id, p.sku, p.name, p.unit,
               coalesce(sum(-m.on_hand_delta) FILTER (WHERE m.type = 'CONSUME'), 0) AS consumed,
               coalesce(sum(m.on_hand_delta) FILTER (WHERE m.type = 'RETURN'), 0) AS returned
        FROM stock_movements m JOIN parts p ON p.id = m.part_id
        WHERE m.organization_id = ${org}::uuid AND ${this.branchSql(Prisma.sql`m.branch_id`, branches)}
          AND m.type IN ('CONSUME', 'RETURN') AND m.created_at >= ${from} AND m.created_at < ${to}
        GROUP BY p.id, p.sku, p.name, p.unit ORDER BY consumed DESC, p.sku`,
      this.prisma.$queryRaw<
        {
          branch_code: string;
          sku: string;
          name: string;
          on_hand: Prisma.Decimal;
          reserved: Prisma.Decimal;
          reorder: Prisma.Decimal;
          unit_cost: Prisma.Decimal | null;
        }[]
      >`
        SELECT b.code AS branch_code, p.sku, p.name, s.on_hand, s.reserved, coalesce(s.reorder_level, p.reorder_level) AS reorder,
               (SELECT m.unit_cost FROM stock_movements m
                 WHERE m.branch_id = s.branch_id AND m.part_id = s.part_id AND m.type = 'RECEIVE' AND m.unit_cost IS NOT NULL
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS unit_cost
        FROM branch_stock s JOIN parts p ON p.id = s.part_id JOIN branches b ON b.id = s.branch_id
        WHERE s.organization_id = ${org}::uuid AND ${this.branchSql(Prisma.sql`s.branch_id`, branches)}
        ORDER BY b.code, p.sku`,
    ]);
    let valuationTotal = new Decimal(0);
    return {
      usage: usage.map((u) => {
        const consumed = new Decimal(u.consumed.toString());
        const returned = new Decimal(u.returned.toString());
        return {
          partId: u.part_id,
          sku: u.sku,
          name: u.name,
          unit: u.unit,
          consumed: consumed.toFixed(4),
          returned: returned.toFixed(4),
          netUsed: consumed.minus(returned).toFixed(4),
        };
      }),
      valuation: valuation.map((v) => {
        const onHand = new Decimal(v.on_hand.toString());
        const value = v.unit_cost === null ? null : onHand.times(v.unit_cost.toString());
        if (value) valuationTotal = valuationTotal.plus(value);
        return {
          branchCode: v.branch_code,
          sku: v.sku,
          name: v.name,
          onHand: onHand.toFixed(4),
          reserved: money(v.reserved),
          latestUnitCost: v.unit_cost === null ? null : money(v.unit_cost),
          value: value ? value.toFixed(4) : null,
          belowReorderLevel: onHand.minus(v.reserved.toString()).lte(v.reorder.toString()),
        };
      }),
      valuationTotal: valuationTotal.toFixed(4),
    };
  }

  /**
   * Interim receivables until invoicing (Phase 7): jobs whose repair is
   * finished, with an APPROVED current estimate, where the customer-payable
   * amount exceeds net payments. Same basis as the delivery balance (ADR 0017).
   */
  private outstandingRows(org: string, branches: string[] | null) {
    return this.prisma.$queryRaw<
      {
        job_id: string;
        job_number: string;
        branch_code: string;
        customer_name: string;
        status: OutstandingReport['rows'][number]['status'];
        completed_at: Date | null;
        billed: Prisma.Decimal;
        paid: Prisma.Decimal;
        due: Prisma.Decimal;
        age_days: number;
      }[]
    >`
      WITH current_estimate AS (
        SELECT DISTINCT ON (e.job_id) e.job_id, e.status, e.customer_payable
        FROM estimates e WHERE e.organization_id = ${org}::uuid AND e.status NOT IN ('DRAFT', 'WITHDRAWN')
        ORDER BY e.job_id, e.version DESC),
      paid AS (
        SELECT p.job_id, sum(p.amount - p.refunded_total) AS paid FROM payments p
        WHERE p.organization_id = ${org}::uuid AND p.status = 'RECORDED' AND p.job_id IS NOT NULL GROUP BY p.job_id)
      SELECT j.id AS job_id, j.job_number, b.code AS branch_code, c.name AS customer_name, j.status::text AS status, j.completed_at,
             ce.customer_payable AS billed, coalesce(pd.paid, 0) AS paid, ce.customer_payable - coalesce(pd.paid, 0) AS due,
             greatest(0, floor(extract(epoch FROM (now() - coalesce(j.completed_at, j.updated_at))) / 86400))::int AS age_days
      FROM service_jobs j
      JOIN current_estimate ce ON ce.job_id = j.id AND ce.status = 'APPROVED'
      LEFT JOIN paid pd ON pd.job_id = j.id
      JOIN branches b ON b.id = j.branch_id
      JOIN customers c ON c.id = j.customer_id
      WHERE j.organization_id = ${org}::uuid AND ${this.branchSql(Prisma.sql`j.branch_id`, branches)}
        AND j.status::text = ANY(${[...FINISHED]}::text[])
        AND ce.customer_payable - coalesce(pd.paid, 0) > 0
      ORDER BY age_days DESC, j.job_number`;
  }

  async outstanding(principal: Principal, branchId?: string): Promise<OutstandingReport> {
    const [rows, { currency }] = await Promise.all([
      this.outstandingRows(principal.organizationId, this.scope(principal, branchId)),
      this.settings.get(principal.organizationId, 'money'),
    ]);
    const bucketOf = (days: number) =>
      days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
    const totals = new Map(AGING_BUCKETS.map((b) => [b, { jobs: 0, due: new Decimal(0) }]));
    let total = new Decimal(0);
    const mapped = rows.map((r) => {
      const bucket = bucketOf(r.age_days);
      const due = new Decimal(r.due.toString());
      const t = totals.get(bucket);
      if (t) {
        t.jobs += 1;
        t.due = t.due.plus(due);
      }
      total = total.plus(due);
      return {
        jobId: r.job_id,
        jobNumber: r.job_number,
        branchCode: r.branch_code,
        customerName: r.customer_name,
        status: r.status,
        completedAt: iso(r.completed_at),
        billed: money(r.billed),
        paid: money(r.paid),
        due: due.toFixed(4),
        ageDays: r.age_days,
        bucket,
      } as const;
    });
    return {
      basis: 'APPROVED_ESTIMATE',
      currency,
      total: total.toFixed(4),
      buckets: AGING_BUCKETS.map((bucket) => ({
        bucket,
        jobs: totals.get(bucket)?.jobs ?? 0,
        due: (totals.get(bucket)?.due ?? new Decimal(0)).toFixed(4),
      })),
      rows: mapped,
    };
  }

  /** Delivery register rows for export (same scope rules as GET /deliveries). */
  async deliveries(principal: Principal, from: Date, to: Date, branchId?: string, limit = 10_001) {
    const branches = this.scope(principal, branchId);
    return this.prisma.$queryRaw<
      {
        challan_number: string;
        job_number: string;
        branch_code: string;
        mode: string;
        status: string;
        recipient_name: string | null;
        dispatched_at: Date | null;
        delivered_at: Date | null;
        due_override: boolean;
        customer_name: string;
      }[]
    >`
      SELECT d.challan_number, j.job_number, b.code AS branch_code, d.mode::text AS mode, d.status::text AS status, d.recipient_name,
             d.dispatched_at, d.delivered_at, (d.due_override_reason IS NOT NULL) AS due_override, c.name AS customer_name
      FROM deliveries d JOIN service_jobs j ON j.id = d.job_id JOIN branches b ON b.id = d.branch_id JOIN customers c ON c.id = j.customer_id
      WHERE d.organization_id = ${principal.organizationId}::uuid AND ${this.branchSql(Prisma.sql`d.branch_id`, branches)}
        AND d.created_at >= ${from} AND d.created_at < ${to}
      ORDER BY d.created_at DESC LIMIT ${limit}`;
  }
}
