import {
  CUSTOMER_STATUS_BY_JOB_STATUS,
  CUSTOMER_STATUS_LABELS,
  type ChecklistItem,
  type CustomerJob,
  type JobDetail,
  type JobSummary,
} from '@icon/contracts';
import type { Prisma } from '@icon/database';

export const JOB_SUMMARY_SELECT = {
  id: true,
  jobNumber: true,
  status: true,
  serviceType: true,
  serviceMode: true,
  receivedAt: true,
  createdAt: true,
  branch: { select: { id: true, code: true, name: true } },
  customer: { select: { id: true, customerCode: true, name: true, phoneDisplay: true } },
  asset: {
    select: {
      id: true,
      brand: true,
      model: true,
      serialNumber: true,
      category: { select: { name: true } },
    },
  },
} satisfies Prisma.ServiceJobSelect;

export const JOB_DETAIL_SELECT = {
  ...JOB_SUMMARY_SELECT,
  complaint: true,
  intakeChecklist: true,
  accessoriesReceived: true,
  conditionNotes: true,
  serviceAddress: true,
  channel: true,
  expectedCompletionDate: true,
  warrantyVerification: true,
  acknowledgementMethod: true,
  version: true,
  attachments: {
    select: {
      id: true,
      fileId: true,
      category: true,
      visibility: true,
      file: { select: { originalName: true, mimeType: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  statusHistory: {
    select: {
      fromStatus: true,
      toStatus: true,
      channel: true,
      reason: true,
      customerMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ServiceJobSelect;

/** Customer view adds customer-visible progress messages only. */
export const CUSTOMER_JOB_SELECT = {
  ...JOB_DETAIL_SELECT,
  workLogs: {
    where: { visibility: 'CUSTOMER' },
    select: { description: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ServiceJobSelect;

type CustomerRow = Prisma.ServiceJobGetPayload<{ select: typeof CUSTOMER_JOB_SELECT }>;

type SummaryRow = Prisma.ServiceJobGetPayload<{ select: typeof JOB_SUMMARY_SELECT }>;
type DetailRow = Prisma.ServiceJobGetPayload<{ select: typeof JOB_DETAIL_SELECT }>;

export function toJobSummary(row: SummaryRow): JobSummary {
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    status: row.status,
    customerStatus: CUSTOMER_STATUS_BY_JOB_STATUS[row.status],
    serviceType: row.serviceType,
    serviceMode: row.serviceMode,
    branch: row.branch,
    customer: {
      id: row.customer.id,
      customerCode: row.customer.customerCode,
      name: row.customer.name,
      phone: row.customer.phoneDisplay,
    },
    asset: {
      id: row.asset.id,
      category: row.asset.category.name,
      brand: row.asset.brand,
      model: row.asset.model,
      serialNumber: row.asset.serialNumber,
    },
    receivedAt: row.receivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toJobDetail(row: DetailRow): JobDetail {
  return {
    ...toJobSummary(row),
    complaint: row.complaint,
    intakeChecklist: row.intakeChecklist as ChecklistItem[],
    accessoriesReceived: row.accessoriesReceived,
    conditionNotes: row.conditionNotes,
    serviceAddress: row.serviceAddress ?? null,
    channel: row.channel,
    expectedCompletionDate: row.expectedCompletionDate?.toISOString().slice(0, 10) ?? null,
    warrantyVerification: row.warrantyVerification,
    acknowledgementMethod: row.acknowledgementMethod,
    attachments: row.attachments.map((a) => ({
      id: a.id,
      fileId: a.fileId,
      category: a.category,
      visibility: a.visibility,
      originalName: a.file.originalName,
      mimeType: a.file.mimeType,
    })),
    statusHistory: row.statusHistory.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
    version: row.version,
  };
}

/**
 * Customer view: whitelisted fields only. Internal statuses, reasons, staff
 * identities and internal attachments are never included (CLAUDE.md §4.3).
 */
export function toCustomerJob(row: CustomerRow): CustomerJob {
  const timeline: CustomerJob['timeline'] = [];
  for (const h of row.statusHistory) {
    const status = CUSTOMER_STATUS_BY_JOB_STATUS[h.toStatus];
    // Collapse consecutive internal steps that map to the same customer status.
    if (timeline.at(-1)?.status === status) continue;
    timeline.push({
      status,
      label: CUSTOMER_STATUS_LABELS[status],
      message: h.customerMessage,
      at: h.createdAt.toISOString(),
    });
  }
  const status = CUSTOMER_STATUS_BY_JOB_STATUS[row.status];
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    status,
    statusLabel: CUSTOMER_STATUS_LABELS[status],
    serviceMode: row.serviceMode,
    branch: { name: row.branch.name },
    device: {
      category: row.asset.category.name,
      brand: row.asset.brand,
      model: row.asset.model,
      serialNumber: row.asset.serialNumber,
    },
    complaint: row.complaint,
    submittedAt: row.createdAt.toISOString(),
    updates: row.workLogs.map((w) => ({ message: w.description, at: w.createdAt.toISOString() })),
    timeline,
  };
}
