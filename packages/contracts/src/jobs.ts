import { z } from 'zod';

import { AddressSchema } from './customers.js';

export const SERVICE_TYPES = ['IN_WARRANTY', 'OUT_OF_WARRANTY', 'WARRANTY_UNVERIFIED'] as const;
export const SERVICE_MODES = ['AT_SERVICE_CENTRE', 'ON_SITE'] as const;
export const JOB_STATUSES = [
  'AWAITING_DEVICE',
  'RECEIVED',
  'WARRANTY_CHECK',
  'DIAGNOSIS',
  'ESTIMATE_PREPARATION',
  'AWAITING_CUSTOMER_APPROVAL',
  'WAITING_FOR_PARTS',
  'REPAIR_IN_PROGRESS',
  'QUALITY_CHECK',
  'REPAIR_COMPLETED',
  'READY_FOR_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'ON_HOLD',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CUSTOMER_STATUSES = [
  'REQUEST_RECEIVED',
  'RECEIVED',
  'IN_DIAGNOSIS',
  'AWAITING_YOUR_APPROVAL',
  'IN_REPAIR',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'ON_HOLD',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/**
 * Internal → customer-facing status (CLAUDE.md §4.3). Customers never see
 * internal workflow terms; several internal steps share one customer message.
 */
export const CUSTOMER_STATUS_BY_JOB_STATUS: Record<JobStatus, CustomerStatus> = {
  AWAITING_DEVICE: 'REQUEST_RECEIVED',
  RECEIVED: 'RECEIVED',
  WARRANTY_CHECK: 'IN_DIAGNOSIS',
  DIAGNOSIS: 'IN_DIAGNOSIS',
  ESTIMATE_PREPARATION: 'IN_DIAGNOSIS',
  AWAITING_CUSTOMER_APPROVAL: 'AWAITING_YOUR_APPROVAL',
  WAITING_FOR_PARTS: 'IN_REPAIR',
  REPAIR_IN_PROGRESS: 'IN_REPAIR',
  QUALITY_CHECK: 'IN_REPAIR',
  REPAIR_COMPLETED: 'READY_FOR_PICKUP',
  READY_FOR_DELIVERY: 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  ON_HOLD: 'ON_HOLD',
};

/** Default English customer-facing labels (localization later). */
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  REQUEST_RECEIVED: 'Request received',
  RECEIVED: 'Device received',
  IN_DIAGNOSIS: 'Being checked',
  AWAITING_YOUR_APPROVAL: 'Waiting for your approval',
  IN_REPAIR: 'Repair in progress',
  READY_FOR_PICKUP: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  ON_HOLD: 'On hold',
};

export const ChecklistItemSchema = z.object({
  item: z.string().trim().min(1).max(100),
  checked: z.boolean(),
  note: z.string().trim().max(300).optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/** Default intake checklist (configurable later through settings). */
export const DEFAULT_INTAKE_CHECKLIST = [
  'Device powers on',
  'Display / screen intact',
  'Customer data backup discussed',
  'Password / passcode recorded or declined',
  'Physical damage noted',
] as const;

const complaint = z
  .string()
  .trim()
  .min(5, 'Describe the problem (at least 5 characters)')
  .max(4000);
const accessories = z.array(z.string().trim().min(1).max(100)).max(30).default([]);

export const CreateJobRequestSchema = z
  .object({
    branchId: z.uuid(),
    customerId: z.uuid(),
    assetId: z.uuid(),
    serviceType: z.enum(SERVICE_TYPES),
    serviceMode: z.enum(SERVICE_MODES),
    complaint,
    intakeChecklist: z.array(ChecklistItemSchema).max(40).default([]),
    accessoriesReceived: accessories,
    conditionNotes: z.string().trim().max(2000).optional(),
    serviceAddress: AddressSchema.optional(),
    expectedCompletionDate: z.iso.date().optional(),
    /** How the customer acknowledged the intake details. */
    acknowledgementMethod: z.enum(['SIGNED_PAPER', 'VERBAL']).optional(),
    attachmentFileIds: z.array(z.uuid()).max(20).default([]),
  })
  .refine((v) => v.serviceMode !== 'ON_SITE' || v.serviceAddress !== undefined, {
    message: 'A service address is required for on-site service',
    path: ['serviceAddress'],
  });
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JobListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  branchId: z.uuid().optional(),
  customerId: z.uuid().optional(),
});

export const JobSummarySchema = z.object({
  id: z.uuid(),
  jobNumber: z.string(),
  status: z.enum(JOB_STATUSES),
  customerStatus: z.enum(CUSTOMER_STATUSES),
  serviceType: z.enum(SERVICE_TYPES),
  serviceMode: z.enum(SERVICE_MODES),
  branch: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  customer: z.object({
    id: z.uuid(),
    customerCode: z.string(),
    name: z.string(),
    phone: z.string(),
  }),
  asset: z.object({
    id: z.uuid(),
    category: z.string(),
    brand: z.string(),
    model: z.string(),
    serialNumber: z.string().nullable(),
  }),
  receivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobDetailSchema = JobSummarySchema.extend({
  complaint: z.string(),
  intakeChecklist: z.array(ChecklistItemSchema),
  accessoriesReceived: z.array(z.string()),
  conditionNotes: z.string().nullable(),
  serviceAddress: z.unknown().nullable(),
  channel: z.enum(['STAFF', 'CUSTOMER_APP', 'WEB_PORTAL']),
  expectedCompletionDate: z.iso.date().nullable(),
  warrantyVerification: z.enum(['NOT_CHECKED', 'VERIFIED', 'REJECTED']),
  acknowledgementMethod: z.string().nullable(),
  attachments: z.array(
    z.object({
      id: z.uuid(),
      fileId: z.uuid(),
      category: z.string(),
      visibility: z.enum(['INTERNAL', 'CUSTOMER']),
      originalName: z.string(),
      mimeType: z.string(),
    }),
  ),
  statusHistory: z.array(
    z.object({
      fromStatus: z.enum(JOB_STATUSES).nullable(),
      toStatus: z.enum(JOB_STATUSES),
      channel: z.string(),
      reason: z.string().nullable(),
      customerMessage: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  version: z.number().int(),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

// ---------------------------------------------------------------- customer side

export const CustomerComplaintRequestSchema = z
  .object({
    branchId: z.uuid(),
    /** Existing own device, or details of a new one. */
    assetId: z.uuid().optional(),
    newAsset: z
      .object({
        categoryId: z.uuid(),
        brand: z.string().trim().min(1).max(100),
        model: z.string().trim().min(1).max(150),
        serialNumber: z.string().trim().max(100).optional(),
      })
      .optional(),
    /** Customer's claim; staff verify warranty later. */
    warrantyClaim: z.enum(['IN_WARRANTY', 'OUT_OF_WARRANTY', 'NOT_SURE']),
    serviceMode: z.enum(SERVICE_MODES),
    complaint,
    accessories: accessories,
    serviceAddress: AddressSchema.optional(),
    photoFileIds: z.array(z.uuid()).max(6).default([]),
  })
  .refine((v) => (v.assetId === undefined) !== (v.newAsset === undefined), {
    message: 'Choose an existing device or describe a new one',
    path: ['assetId'],
  })
  .refine((v) => v.serviceMode !== 'ON_SITE' || v.serviceAddress !== undefined, {
    message: 'A service address is required for on-site service',
    path: ['serviceAddress'],
  });
export type CustomerComplaintRequest = z.infer<typeof CustomerComplaintRequestSchema>;

/** What a customer may see about their job — no internal notes or statuses. */
export const CustomerJobSchema = z.object({
  id: z.uuid(),
  jobNumber: z.string(),
  status: z.enum(CUSTOMER_STATUSES),
  statusLabel: z.string(),
  serviceMode: z.enum(SERVICE_MODES),
  branch: z.object({ name: z.string() }),
  device: z.object({
    category: z.string(),
    brand: z.string(),
    model: z.string(),
    serialNumber: z.string().nullable(),
  }),
  complaint: z.string(),
  submittedAt: z.iso.datetime(),
  timeline: z.array(
    z.object({
      status: z.enum(CUSTOMER_STATUSES),
      label: z.string(),
      message: z.string().nullable(),
      at: z.iso.datetime(),
    }),
  ),
});
export type CustomerJob = z.infer<typeof CustomerJobSchema>;

export const DocumentLinkSchema = z.object({
  documentId: z.uuid(),
  documentNumber: z.string(),
  version: z.number().int(),
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type DocumentLink = z.infer<typeof DocumentLinkSchema>;

export const ReceiptLayoutSchema = z.enum(['A4', 'THERMAL_80']);
