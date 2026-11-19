import { z } from 'zod';

import { JOB_STATUSES } from './jobs.js';

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** Exports larger than this are refused; narrow the filters (ADR 0019). */
export const MAX_EXPORT_ROWS = 10_000;

export const EXPORTABLE_REPORTS = [
  'jobs',
  'technicians',
  'parts',
  'outstanding',
  'collections',
  'deliveries',
  'invoices',
  'gst-summary',
] as const;
export type ExportableReport = (typeof EXPORTABLE_REPORTS)[number];

const isoDate = z.iso.datetime({ offset: true });
const optionalUuid = z.uuid().optional();

/** Date range [from, to); at most 366 days so reports stay bounded. */
export const PeriodSchema = z
  .object({ from: isoDate, to: isoDate, branchId: optionalUuid })
  .refine((q) => new Date(q.from) < new Date(q.to), {
    path: ['to'],
    message: 'Must be after "from"',
  })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= 366 * 86_400_000, {
    path: ['to'],
    message: 'Choose a period of at most 366 days',
  });

export const JobRegisterQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    branchId: optionalUuid,
    status: z.enum(JOB_STATUSES).optional(),
    technicianId: optionalUuid,
    categoryId: optionalUuid,
    serviceType: z.enum(['IN_WARRANTY', 'OUT_OF_WARRANTY', 'WARRANTY_UNVERIFIED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => new Date(q.from) < new Date(q.to), {
    path: ['to'],
    message: 'Must be after "from"',
  })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= 366 * 86_400_000, {
    path: ['to'],
    message: 'Choose a period of at most 366 days',
  });
export type JobRegisterQuery = z.infer<typeof JobRegisterQuerySchema>;

export const DashboardSchema = z.object({
  generatedAt: z.iso.datetime(),
  timezone: z.string(),
  currency: z.string().nullable(),
  newJobsToday: z.number().int(),
  jobsByStatus: z.array(z.object({ status: z.enum(JOB_STATUSES), count: z.number().int() })),
  overdueJobs: z.number().int(),
  awaitingApproval: z.number().int(),
  waitingForParts: z.number().int(),
  repairCompleted: z.number().int(),
  readyForDelivery: z.number().int(),
  collectedToday: z.string(),
  collectedThisMonth: z.string(),
  /** Interim: approved estimates minus net payments on completed jobs (until invoicing, ADR 0019). */
  outstanding: z.object({ total: z.string(), jobs: z.number().int() }),
  technicianWorkload: z.array(
    z.object({
      user: z.object({ id: z.uuid(), fullName: z.string() }),
      openJobs: z.number().int(),
    }),
  ),
  /** Jobs received in the last 30 days by service type. */
  warrantyMix: z.array(z.object({ serviceType: z.string(), count: z.number().int() })),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const JobRegisterRowSchema = z.object({
  id: z.uuid(),
  jobNumber: z.string(),
  branchCode: z.string(),
  receivedAt: z.iso.datetime(),
  customerName: z.string(),
  category: z.string(),
  device: z.string(),
  serialNumber: z.string().nullable(),
  serviceType: z.string(),
  status: z.enum(JOB_STATUSES),
  technicians: z.string(),
  expectedCompletionDate: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
});
export type JobRegisterRow = z.infer<typeof JobRegisterRowSchema>;

export const TechnicianPerformanceRowSchema = z.object({
  user: z.object({ id: z.uuid(), fullName: z.string() }),
  openJobs: z.number().int(),
  completedJobs: z.number().int(),
  /** Hours from receipt to repair completion, for jobs completed in the period. */
  averageTurnaroundHours: z.string().nullable(),
  medianTurnaroundHours: z.string().nullable(),
});
export type TechnicianPerformanceRow = z.infer<typeof TechnicianPerformanceRowSchema>;

export const PartsReportSchema = z.object({
  usage: z.array(
    z.object({
      partId: z.uuid(),
      sku: z.string(),
      name: z.string(),
      unit: z.string(),
      consumed: z.string(),
      returned: z.string(),
      netUsed: z.string(),
    }),
  ),
  /** Indicative only: on hand × latest purchase cost (valuation method not confirmed, ADR 0019). */
  valuation: z.array(
    z.object({
      branchCode: z.string(),
      sku: z.string(),
      name: z.string(),
      onHand: z.string(),
      reserved: z.string(),
      latestUnitCost: z.string().nullable(),
      value: z.string().nullable(),
      belowReorderLevel: z.boolean(),
    }),
  ),
  valuationTotal: z.string(),
});
export type PartsReport = z.infer<typeof PartsReportSchema>;

export const AGING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;

export const OutstandingRowSchema = z.object({
  jobId: z.uuid(),
  jobNumber: z.string(),
  branchCode: z.string(),
  customerName: z.string(),
  status: z.enum(JOB_STATUSES),
  completedAt: z.iso.datetime().nullable(),
  billed: z.string(),
  paid: z.string(),
  due: z.string(),
  ageDays: z.number().int(),
  /** INVOICE when the job has issued invoices (net of credit notes), else the approved estimate. */
  basis: z.enum(['INVOICE', 'ESTIMATE']),
  bucket: z.enum(AGING_BUCKETS),
});
export const OutstandingReportSchema = z.object({
  basis: z.literal('INVOICE_OR_ESTIMATE'),
  currency: z.string().nullable(),
  total: z.string(),
  buckets: z.array(
    z.object({ bucket: z.enum(AGING_BUCKETS), jobs: z.number().int(), due: z.string() }),
  ),
  rows: z.array(OutstandingRowSchema),
});
export type OutstandingReport = z.infer<typeof OutstandingReportSchema>;

export const ExportQuerySchema = z.object({ format: z.enum(EXPORT_FORMATS) });

/** Date range for tax reports (inclusive calendar dates, business time zone). */
export const DateRangeSchema = z
  .object({ from: z.iso.date(), to: z.iso.date(), branchId: z.uuid().optional() })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'Must be on or after "from"' });
export type DateRange = z.infer<typeof DateRangeSchema>;
