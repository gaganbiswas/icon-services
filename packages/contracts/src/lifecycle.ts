import { z } from 'zod';

import { JOB_STATUSES, type JobStatus } from './jobs.js';
import type { PermissionCode } from './permissions.js';

export interface TransitionRule {
  readonly to: JobStatus;
  /** A written reason is mandatory. */
  readonly reasonRequired?: boolean;
  /** Extra permission beyond `jobs.transition`. */
  readonly permission?: PermissionCode;
  /** Business precondition checked by the API. */
  readonly guard?:
    | 'APPROVED_ESTIMATE'
    | 'REJECTED_ESTIMATE'
    | 'COMPLETION_RECORD'
    | 'DELIVERY_WORKFLOW'
    | 'RECEIVE_ACTION'
    | 'RESUME_TARGET';
}

const hold: TransitionRule = { to: 'ON_HOLD', reasonRequired: true };
const cancel: TransitionRule = { to: 'CANCELLED', reasonRequired: true };

/**
 * Valid job status transitions (CLAUDE.md §4.3, ADR 0013). Anything not listed
 * is rejected. ON_HOLD resumes only to the status held from.
 */
const BASE_TRANSITIONS: Record<Exclude<JobStatus, 'ON_HOLD'>, readonly TransitionRule[]> = {
  AWAITING_DEVICE: [{ to: 'RECEIVED', guard: 'RECEIVE_ACTION' }, cancel],
  RECEIVED: [{ to: 'WARRANTY_CHECK' }, { to: 'DIAGNOSIS' }, hold, cancel],
  WARRANTY_CHECK: [{ to: 'DIAGNOSIS' }, hold, cancel],
  DIAGNOSIS: [{ to: 'ESTIMATE_PREPARATION' }, hold, cancel],
  ESTIMATE_PREPARATION: [
    { to: 'AWAITING_CUSTOMER_APPROVAL' },
    { to: 'DIAGNOSIS', reasonRequired: true },
    hold,
    cancel,
  ],
  AWAITING_CUSTOMER_APPROVAL: [
    { to: 'REPAIR_IN_PROGRESS', guard: 'APPROVED_ESTIMATE' },
    { to: 'WAITING_FOR_PARTS', guard: 'APPROVED_ESTIMATE' },
    { to: 'ESTIMATE_PREPARATION', reasonRequired: true },
    // "Return unrepaired" after the customer rejects (ADR 0014).
    { to: 'READY_FOR_DELIVERY', reasonRequired: true, guard: 'REJECTED_ESTIMATE' },
    hold,
    cancel,
  ],
  WAITING_FOR_PARTS: [{ to: 'REPAIR_IN_PROGRESS' }, hold, cancel],
  REPAIR_IN_PROGRESS: [{ to: 'WAITING_FOR_PARTS' }, { to: 'QUALITY_CHECK' }, hold],
  QUALITY_CHECK: [
    { to: 'REPAIR_COMPLETED', guard: 'COMPLETION_RECORD' },
    { to: 'REPAIR_IN_PROGRESS', reasonRequired: true },
  ],
  REPAIR_COMPLETED: [{ to: 'READY_FOR_DELIVERY' }],
  READY_FOR_DELIVERY: [
    { to: 'OUT_FOR_DELIVERY', guard: 'DELIVERY_WORKFLOW' },
    { to: 'DELIVERED', guard: 'DELIVERY_WORKFLOW' },
    hold,
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', guard: 'DELIVERY_WORKFLOW' },
    { to: 'READY_FOR_DELIVERY', reasonRequired: true, guard: 'DELIVERY_WORKFLOW' },
  ],
  DELIVERED: [{ to: 'RECEIVED', reasonRequired: true, permission: 'jobs.reopen' }],
  CANCELLED: [{ to: 'RECEIVED', reasonRequired: true, permission: 'jobs.reopen' }],
};

/** Statuses a job can be put on hold from — and therefore resumed to. */
const HOLDABLE = (Object.keys(BASE_TRANSITIONS) as (keyof typeof BASE_TRANSITIONS)[]).filter(
  (status) => BASE_TRANSITIONS[status].some((rule) => rule.to === 'ON_HOLD'),
);

export const TRANSITIONS: Record<JobStatus, readonly TransitionRule[]> = {
  ...BASE_TRANSITIONS,
  ON_HOLD: [...HOLDABLE.map((to) => ({ to, guard: 'RESUME_TARGET' as const })), cancel],
};

export type TransitionError =
  | 'INVALID_TRANSITION'
  | 'REASON_REQUIRED'
  | 'FORBIDDEN'
  | 'ESTIMATE_APPROVAL_REQUIRED'
  | 'ESTIMATE_REJECTION_REQUIRED'
  | 'COMPLETION_REQUIRED'
  | 'USE_DELIVERY_WORKFLOW'
  | 'USE_RECEIVE_ACTION';

export interface TransitionContext {
  readonly permissions: ReadonlySet<string>;
  readonly reason?: string | undefined;
  /** Status before the current hold (ON_HOLD only). */
  readonly heldFrom?: JobStatus | null | undefined;
  readonly hasApprovedEstimate?: boolean;
  readonly hasRejectedEstimate?: boolean;
  readonly hasCompletionRecord?: boolean;
}

/** Pure transition check shared by the API and UI. */
export function checkTransition(
  from: JobStatus,
  to: JobStatus,
  ctx: TransitionContext,
): TransitionError | null {
  const rule = TRANSITIONS[from].find((r) => r.to === to);
  if (!rule) return 'INVALID_TRANSITION';
  if (rule.guard === 'RESUME_TARGET' && ctx.heldFrom !== to) return 'INVALID_TRANSITION';
  if (
    !ctx.permissions.has('jobs.transition') ||
    (rule.permission && !ctx.permissions.has(rule.permission))
  )
    return 'FORBIDDEN';
  if (rule.reasonRequired && !ctx.reason?.trim()) return 'REASON_REQUIRED';
  if (rule.guard === 'RECEIVE_ACTION') return 'USE_RECEIVE_ACTION';
  if (rule.guard === 'DELIVERY_WORKFLOW') return 'USE_DELIVERY_WORKFLOW';
  if (rule.guard === 'APPROVED_ESTIMATE' && !ctx.hasApprovedEstimate)
    return 'ESTIMATE_APPROVAL_REQUIRED';
  if (rule.guard === 'REJECTED_ESTIMATE' && !ctx.hasRejectedEstimate)
    return 'ESTIMATE_REJECTION_REQUIRED';
  if (rule.guard === 'COMPLETION_RECORD' && !ctx.hasCompletionRecord) return 'COMPLETION_REQUIRED';
  return null;
}

/** Targets offered in the UI (guards needing other workflows excluded). */
export function availableTransitions(
  from: JobStatus,
  ctx: Omit<TransitionContext, 'reason'>,
): { to: JobStatus; reasonRequired: boolean }[] {
  return TRANSITIONS[from]
    .filter((r) => r.guard !== 'RECEIVE_ACTION' && r.guard !== 'DELIVERY_WORKFLOW')
    .filter((r) => {
      const error = checkTransition(from, r.to, { ...ctx, reason: 'x' });
      return error === null || error === 'COMPLETION_REQUIRED';
    })
    .map((r) => ({ to: r.to, reasonRequired: r.reasonRequired ?? false }));
}

// ------------------------------------------------------------- request DTOs

const reason = z.string().trim().min(1).max(1000);
const customerMessage = z.string().trim().min(1).max(500);

export const TransitionRequestSchema = z.object({
  to: z.enum(JOB_STATUSES),
  version: z.number().int().min(1),
  reason: reason.optional(),
  /** Optional customer-visible message; never internal detail. */
  customerMessage: customerMessage.optional(),
});
export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

export const QC_CHECKLIST = [
  'Reported problem resolved',
  'Device powers on and boots normally',
  'All screws, panels and covers refitted',
  'Accessories ready to return',
  'Device cleaned',
] as const;

export const CompletionRequestSchema = z.object({
  version: z.number().int().min(1),
  repairSummary: z
    .string()
    .trim()
    .min(10, 'Summarise the repair (at least 10 characters)')
    .max(4000),
  qcChecklist: z
    .array(z.object({ item: z.string().min(1).max(100), passed: z.boolean() }))
    .min(1)
    .max(30),
  customerMessage: customerMessage.optional(),
});
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

export const ReceiveDeviceRequestSchema = z.object({
  version: z.number().int().min(1),
  intakeChecklist: z
    .array(
      z.object({
        item: z.string().trim().min(1).max(100),
        checked: z.boolean(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .max(40)
    .default([]),
  accessoriesReceived: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  conditionNotes: z.string().trim().max(2000).optional(),
  acknowledgementMethod: z.enum(['SIGNED_PAPER', 'VERBAL']),
  attachmentFileIds: z.array(z.uuid()).max(20).default([]),
});
export type ReceiveDeviceRequest = z.infer<typeof ReceiveDeviceRequestSchema>;

export const AssignTechnicianRequestSchema = z.object({
  technicianUserId: z.uuid(),
  note: z.string().trim().max(500).optional(),
});

export const DiagnosisRequestSchema = z.object({
  symptom: z.string().trim().min(1).max(2000),
  findings: z.string().trim().min(1).max(4000),
  rootCause: z.string().trim().max(2000).optional(),
  recommendation: z.string().trim().max(2000).optional(),
  internalNotes: z.string().trim().max(4000).optional(),
});
export type DiagnosisRequest = z.infer<typeof DiagnosisRequestSchema>;

export const WorkLogRequestSchema = z
  .object({
    description: z.string().trim().min(1).max(4000),
    durationMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
    visibility: z.enum(['INTERNAL', 'CUSTOMER']),
  })
  .refine((v) => v.visibility === 'INTERNAL' || v.description.length <= 500, {
    message: 'Customer-visible updates must be 500 characters or fewer',
    path: ['description'],
  });
export type WorkLogRequest = z.infer<typeof WorkLogRequestSchema>;

export const AddAttachmentRequestSchema = z.object({
  fileId: z.uuid(),
  category: z.enum(['INTAKE_PHOTO', 'WARRANTY_PROOF', 'OTHER']),
  visibility: z.enum(['INTERNAL', 'CUSTOMER']),
});

// --------------------------------------------------------------- responses

export const AssignmentSchema = z.object({
  id: z.uuid(),
  technician: z.object({ id: z.uuid(), fullName: z.string() }),
  assignedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  note: z.string().nullable(),
});

export const DiagnosisSchema = z.object({
  id: z.uuid(),
  technician: z.object({ id: z.uuid(), fullName: z.string() }),
  symptom: z.string(),
  findings: z.string(),
  rootCause: z.string().nullable(),
  recommendation: z.string().nullable(),
  /** Present only for holders of jobs.internal_notes.read. */
  internalNotes: z.string().nullable().optional(),
  createdAt: z.iso.datetime(),
});

export const WorkLogSchema = z.object({
  id: z.uuid(),
  author: z.object({ id: z.uuid(), fullName: z.string() }),
  description: z.string(),
  durationMinutes: z.number().int().nullable(),
  visibility: z.enum(['INTERNAL', 'CUSTOMER']),
  createdAt: z.iso.datetime(),
});

export const JobWorkspaceSchema = z.object({
  assignments: z.array(AssignmentSchema),
  diagnoses: z.array(DiagnosisSchema),
  workLogs: z.array(WorkLogSchema),
  completion: z
    .object({
      repairSummary: z.string(),
      qcChecklist: z.array(z.object({ item: z.string(), passed: z.boolean() })),
      completedAt: z.iso.datetime(),
    })
    .nullable(),
  allowedTransitions: z.array(z.object({ to: z.enum(JOB_STATUSES), reasonRequired: z.boolean() })),
  canWork: z.boolean(),
  canSeeInternalNotes: z.boolean(),
});
export type JobWorkspace = z.infer<typeof JobWorkspaceSchema>;

export const NotificationSchema = z.object({
  id: z.uuid(),
  eventType: z.string(),
  jobId: z.uuid().nullable(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD', 'SKIPPED']),
  attempts: z.number().int(),
  nextAttemptAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  deliveries: z.array(
    z.object({
      channel: z.enum(['WHATSAPP', 'EMAIL']),
      provider: z.string(),
      status: z.enum([
        'ACCEPTED',
        'FAILED',
        'SKIPPED_NO_CONSENT',
        'SKIPPED_NO_ADDRESS',
        'SKIPPED_NOT_CONFIGURED',
        'DELIVERED',
        'READ',
      ]),
      providerMessageId: z.string().nullable(),
      errorCode: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type Notification = z.infer<typeof NotificationSchema>;
