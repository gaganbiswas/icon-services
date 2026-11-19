import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type ExportFormat,
  type ExportableReport,
  JobRegisterQuerySchema,
  MAX_EXPORT_ROWS,
  type PermissionCode,
  PeriodSchema,
  DateRangeSchema,
} from '@icon/contracts';
import type { PrismaClient } from '@icon/database';
import { z } from 'zod';

import { hasPermission } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { PdfRenderer } from '../documents/pdf-renderer.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { type ReportTable, toCsv, toHtml, toXlsx } from './report-table.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { ReportsService } from './reports.service.js';

/** Exclusive upper bound for an inclusive calendar date. */
const nextDay = (date: string) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** Extra permission each export needs on top of reports.read + reports.export. */
export const EXPORT_PERMISSIONS: Record<ExportableReport, PermissionCode> = {
  jobs: 'jobs.read',
  technicians: 'jobs.read',
  parts: 'inventory.read',
  outstanding: 'payments.read',
  collections: 'payments.read',
  deliveries: 'deliveries.read',
  invoices: 'invoices.read',
  'gst-summary': 'invoices.read',
};

const BranchOnly = z.object({ branchId: z.uuid().optional() });
const JobsExportQuery = JobRegisterQuerySchema;

const humanize = (value: string) => value.replace(/_/g, ' ').toLowerCase();

function parse<T extends z.ZodType>(schema: T, query: unknown): z.output<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'The report filters are invalid',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export interface ExportFile {
  readonly filename: string;
  readonly contentType: string;
  readonly body: Buffer;
}

/** Builds report exports (CSV / XLSX / PDF). Every export is permission-checked and audited. */
@Injectable()
export class ReportExportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reports: ReportsService,
    private readonly payments: PaymentsService,
    private readonly pdf: PdfRenderer,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  async export(
    principal: Principal,
    report: ExportableReport,
    format: ExportFormat,
    query: Record<string, unknown>,
  ): Promise<ExportFile> {
    // Same rule as the on-screen report: missing permission looks like "not found".
    if (!hasPermission(principal, EXPORT_PERMISSIONS[report])) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You do not have permission to export this report',
      );
    }
    const tz = await this.reports.timezone(principal.organizationId);
    const table = await this.table(principal, report, query, tz);
    if (table.rows.length > MAX_EXPORT_ROWS) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'EXPORT_TOO_LARGE',
        `Exports are limited to ${MAX_EXPORT_ROWS} rows. Narrow the filters.`,
      );
    }
    const generatedAt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date());
    const body =
      format === 'csv'
        ? toCsv(table)
        : format === 'xlsx'
          ? await toXlsx(table)
          : await this.pdf.render(
              toHtml(
                table,
                await this.reports.organizationName(principal.organizationId),
                `${generatedAt} (${tz})`,
              ),
            );
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'report.exported',
        entityType: 'report',
        after: { report, format, filters: query, rows: table.rows.length },
      }),
    );
    const stamp = new Date().toISOString().slice(0, 10);
    return { filename: `${report}-${stamp}.${format}`, contentType: CONTENT_TYPES[format], body };
  }

  private async table(
    principal: Principal,
    report: ExportableReport,
    query: Record<string, unknown>,
    tz: string,
  ): Promise<ReportTable> {
    const date = (iso: string | null) =>
      iso
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(iso))
        : null;
    const period = (q: { from: string; to: string; branchId?: string | undefined }) =>
      `${date(q.from)} to ${date(q.to)} (${tz})${q.branchId ? ' · one branch' : ' · all permitted branches'}`;

    switch (report) {
      case 'jobs': {
        const q = parse(JobsExportQuery, { ...query, page: 1, pageSize: 1 });
        const page = await this.reports.jobRegister(principal, q, MAX_EXPORT_ROWS + 1);
        return {
          title: 'Job register',
          filters: [
            period(q),
            q.status ? `status ${humanize(q.status)}` : null,
            q.serviceType ? humanize(q.serviceType) : null,
            q.technicianId ? 'one technician' : null,
            q.categoryId ? 'one category' : null,
          ]
            .filter(Boolean)
            .join(' · '),
          columns: [
            { key: 'jobNumber', label: 'Job', type: 'text' },
            { key: 'branchCode', label: 'Branch', type: 'text' },
            { key: 'receivedAt', label: 'Received', type: 'datetime' },
            { key: 'customerName', label: 'Customer', type: 'text' },
            { key: 'category', label: 'Category', type: 'text' },
            { key: 'device', label: 'Device', type: 'text' },
            { key: 'serialNumber', label: 'Serial', type: 'text' },
            { key: 'serviceType', label: 'Service type', type: 'text' },
            { key: 'status', label: 'Status', type: 'text' },
            { key: 'technicians', label: 'Technicians', type: 'text' },
            { key: 'completedAt', label: 'Completed', type: 'datetime' },
            { key: 'deliveredAt', label: 'Delivered', type: 'datetime' },
          ],
          rows: page.items.map((r) => ({
            ...r,
            receivedAt: date(r.receivedAt),
            completedAt: date(r.completedAt),
            deliveredAt: date(r.deliveredAt),
            serviceType: humanize(r.serviceType),
            status: humanize(r.status),
          })),
        };
      }
      case 'technicians': {
        const q = parse(PeriodSchema, query);
        const rows = await this.reports.technicians(
          principal,
          new Date(q.from),
          new Date(q.to),
          q.branchId,
        );
        return {
          title: 'Technician performance',
          filters: period(q),
          notes: [
            'Turnaround = hours from receipt to repair completion, for jobs completed in the period. Open jobs are current.',
          ],
          columns: [
            { key: 'name', label: 'Technician', type: 'text' },
            { key: 'openJobs', label: 'Open jobs', type: 'integer' },
            { key: 'completedJobs', label: 'Completed', type: 'integer' },
            { key: 'avg', label: 'Average hours', type: 'quantity' },
            { key: 'median', label: 'Median hours', type: 'quantity' },
          ],
          rows: rows.map((r) => ({
            name: r.user.fullName,
            openJobs: r.openJobs,
            completedJobs: r.completedJobs,
            avg: r.averageTurnaroundHours,
            median: r.medianTurnaroundHours,
          })),
        };
      }
      case 'parts': {
        const q = parse(PeriodSchema, query);
        const data = await this.reports.parts(
          principal,
          new Date(q.from),
          new Date(q.to),
          q.branchId,
        );
        const usage = new Map(data.usage.map((u) => [u.sku, u]));
        return {
          title: 'Parts usage and stock',
          filters: period(q),
          notes: [
            'Value is indicative: on hand × latest purchase cost. The stock valuation method has not been confirmed by the accountant.',
            `Indicative total value: ${data.valuationTotal}`,
          ],
          columns: [
            { key: 'branchCode', label: 'Branch', type: 'text' },
            { key: 'sku', label: 'SKU', type: 'text' },
            { key: 'name', label: 'Part', type: 'text' },
            { key: 'netUsed', label: 'Net used (period, all branches in scope)', type: 'quantity' },
            { key: 'onHand', label: 'On hand', type: 'quantity' },
            { key: 'reserved', label: 'Reserved', type: 'quantity' },
            { key: 'latestUnitCost', label: 'Latest unit cost', type: 'money' },
            { key: 'value', label: 'Indicative value', type: 'money' },
            { key: 'low', label: 'Below reorder level', type: 'text' },
          ],
          rows: data.valuation.map(({ belowReorderLevel, ...v }) => ({
            ...v,
            netUsed: usage.get(v.sku)?.netUsed ?? '0.0000',
            low: belowReorderLevel ? 'yes' : 'no',
          })),
        };
      }
      case 'outstanding': {
        const q = parse(BranchOnly, query);
        const data = await this.reports.outstanding(principal, q.branchId);
        return {
          title: 'Outstanding balances and aging',
          filters: `${q.branchId ? 'One branch' : 'All permitted branches'} · currency ${data.currency ?? 'not configured'}`,
          notes: [
            'Issued invoices (net of credit notes) minus net payments; finished jobs not yet invoiced use the approved estimate. Age counts from the invoice date (or repair completion).',
            `Total due: ${data.total}`,
          ],
          columns: [
            { key: 'jobNumber', label: 'Job', type: 'text' },
            { key: 'branchCode', label: 'Branch', type: 'text' },
            { key: 'customerName', label: 'Customer', type: 'text' },
            { key: 'status', label: 'Status', type: 'text' },
            { key: 'billed', label: 'Approved', type: 'money' },
            { key: 'paid', label: 'Paid', type: 'money' },
            { key: 'due', label: 'Due', type: 'money' },
            { key: 'ageDays', label: 'Age (days)', type: 'integer' },
            { key: 'bucket', label: 'Bucket', type: 'text' },
          ],
          rows: data.rows.map((r) => ({ ...r, status: humanize(r.status) })),
        };
      }
      case 'collections': {
        const q = parse(PeriodSchema, query);
        const data = await this.payments.collections(
          principal,
          new Date(q.from),
          new Date(q.to),
          q.branchId,
        );
        return {
          title: 'Payment collections',
          filters: `${period(q)} · currency ${data.currency ?? 'not configured'}`,
          notes: [
            'Received = recorded payments in the period; refunded = refunds issued in the period.',
          ],
          columns: [
            { key: 'group', label: 'Group', type: 'text' },
            { key: 'name', label: 'Method / cashier', type: 'text' },
            { key: 'count', label: 'Payments', type: 'integer' },
            { key: 'received', label: 'Received', type: 'money' },
            { key: 'refunded', label: 'Refunded', type: 'money' },
          ],
          rows: [
            ...data.byMethod.map((m) => ({
              group: 'Method',
              name: humanize(m.method),
              count: m.count,
              received: m.received,
              refunded: m.refunded,
            })),
            ...data.byCashier.map((c) => ({
              group: 'Cashier',
              name: c.user.fullName,
              count: c.count,
              received: c.received,
              refunded: null,
            })),
            {
              group: 'Total',
              name: 'Net',
              count: null,
              received: data.received,
              refunded: data.refunded,
            },
          ],
        };
      }
      case 'invoices': {
        const q = parse(DateRangeSchema, query);
        const page = await this.invoices.register(principal, {
          from: q.from,
          to: nextDay(q.to),
          branchId: q.branchId,
          page: 1,
          pageSize: MAX_EXPORT_ROWS + 1,
        });
        return {
          title: 'Invoice register',
          filters: `${q.from} to ${q.to}${q.branchId ? ' · one branch' : ' · all permitted branches'}`,
          columns: [
            { key: 'invoiceNumber', label: 'Invoice', type: 'text' },
            { key: 'invoiceDate', label: 'Date', type: 'date' },
            { key: 'jobNumber', label: 'Job', type: 'text' },
            { key: 'customerName', label: 'Customer', type: 'text' },
            { key: 'recipientGstin', label: 'Customer GSTIN', type: 'text' },
            { key: 'taxableTotal', label: 'Taxable value', type: 'money' },
            { key: 'taxTotal', label: 'GST', type: 'money' },
            { key: 'total', label: 'Total', type: 'money' },
            { key: 'creditedTotal', label: 'Credited', type: 'money' },
            { key: 'balance', label: 'Balance', type: 'money' },
            { key: 'status', label: 'Status', type: 'text' },
          ],
          rows: page.items.map((r) => ({
            ...r,
            status: humanize(r.status === 'ISSUED' ? r.paymentState : r.status),
          })),
        };
      }
      case 'gst-summary': {
        const q = parse(DateRangeSchema, query);
        const s = await this.reports.gstSummary(principal, q);
        return {
          title: 'GST summary',
          filters: `${q.from} to ${q.to} · currency ${s.currency || 'not configured'}`,
          notes: [
            'Invoices by invoice date minus credit notes by note date. A working summary for return preparation; review with the accountant before filing.',
            `Net: taxable ${s.net.taxable}, CGST ${s.net.cgst}, SGST ${s.net.sgst}, IGST ${s.net.igst}, total ${s.net.total}`,
          ],
          columns: [
            { key: 'hsnSac', label: 'HSN/SAC', type: 'text' },
            { key: 'gstRate', label: 'GST rate %', type: 'quantity' },
            { key: 'quantity', label: 'Quantity', type: 'quantity' },
            { key: 'taxable', label: 'Taxable value', type: 'money' },
            { key: 'cgst', label: 'CGST', type: 'money' },
            { key: 'sgst', label: 'SGST', type: 'money' },
            { key: 'igst', label: 'IGST', type: 'money' },
          ],
          rows: s.byHsn,
        };
      }
      case 'deliveries': {
        const q = parse(PeriodSchema, query);
        const rows = await this.reports.deliveries(
          principal,
          new Date(q.from),
          new Date(q.to),
          q.branchId,
          MAX_EXPORT_ROWS + 1,
        );
        return {
          title: 'Delivery register',
          filters: period(q),
          columns: [
            { key: 'challan', label: 'Challan', type: 'text' },
            { key: 'job', label: 'Job', type: 'text' },
            { key: 'branch', label: 'Branch', type: 'text' },
            { key: 'customer', label: 'Customer', type: 'text' },
            { key: 'mode', label: 'Mode', type: 'text' },
            { key: 'status', label: 'Status', type: 'text' },
            { key: 'recipient', label: 'Recipient', type: 'text' },
            { key: 'dispatched', label: 'Dispatched', type: 'datetime' },
            { key: 'delivered', label: 'Delivered', type: 'datetime' },
            { key: 'override', label: 'Balance-due approval', type: 'text' },
          ],
          rows: rows.map((r) => ({
            challan: r.challan_number,
            job: r.job_number,
            branch: r.branch_code,
            customer: r.customer_name,
            mode: humanize(r.mode),
            status: humanize(r.status),
            recipient: r.recipient_name,
            dispatched: date(r.dispatched_at?.toISOString() ?? null),
            delivered: date(r.delivered_at?.toISOString() ?? null),
            override: r.due_override ? 'yes' : 'no',
          })),
        };
      }
    }
  }
}
