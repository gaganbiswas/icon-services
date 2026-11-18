import { z } from 'zod';

import { COVERAGES, MoneyStringSchema, QuantityStringSchema } from './money.js';

export const ESTIMATE_LINE_TYPES = ['LABOUR', 'PART', 'SERVICE_FEE', 'OTHER'] as const;
export const ESTIMATE_STATUSES = [
  'DRAFT',
  'SENT',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'WITHDRAWN',
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const EstimateLineInputSchema = z.object({
  lineType: z.enum(ESTIMATE_LINE_TYPES),
  description: z.string().trim().min(1).max(500),
  sku: z.string().trim().max(60).optional(),
  quantity: QuantityStringSchema,
  unit: z.string().trim().min(1).max(20).default('EA'),
  unitPrice: MoneyStringSchema,
  discount: MoneyStringSchema.default('0'),
  coverage: z.enum(COVERAGES).default('CUSTOMER_PAY'),
});
export type EstimateLineInput = z.infer<typeof EstimateLineInputSchema>;

export const EstimateDraftSchema = z.object({
  lines: z.array(EstimateLineInputSchema).min(1, 'Add at least one line').max(100),
  /** Customer-visible note, e.g. what the repair includes. */
  notes: z.string().trim().max(2000).optional(),
});
export type EstimateDraft = z.infer<typeof EstimateDraftSchema>;

export const UpdateEstimateDraftSchema = EstimateDraftSchema.extend({
  rowVersion: z.number().int().min(1),
});

export const SendEstimateSchema = z.object({ rowVersion: z.number().int().min(1) });

export const EstimateDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    /** Must be true to approve: the customer accepts the terms shown. */
    termsAccepted: z.boolean().default(false),
    comment: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.decision !== 'APPROVED' || v.termsAccepted, {
    message: 'Accept the terms to approve',
    path: ['termsAccepted'],
  });
export type EstimateDecisionRequest = z.infer<typeof EstimateDecisionSchema>;

export const LinkTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,100}$/) });
export const LinkDecisionSchema = z.intersection(LinkTokenSchema, EstimateDecisionSchema);

const MoneyOut = z.string();

export const EstimateLineSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  lineType: z.enum(ESTIMATE_LINE_TYPES),
  description: z.string(),
  sku: z.string().nullable(),
  quantity: MoneyOut,
  unit: z.string(),
  unitPrice: MoneyOut,
  discount: MoneyOut,
  coverage: z.enum(COVERAGES),
  lineTotal: MoneyOut,
});

export const EstimateSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  version: z.number().int(),
  status: z.enum(ESTIMATE_STATUSES),
  /** True when SENT and past its validity date. */
  expired: z.boolean(),
  currency: z.string(),
  subtotal: MoneyOut,
  discountTotal: MoneyOut,
  total: MoneyOut,
  customerPayable: MoneyOut,
  covered: MoneyOut,
  taxNote: z.string(),
  validUntil: z.iso.date().nullable(),
  terms: z.string(),
  notes: z.string().nullable(),
  lines: z.array(EstimateLineSchema),
  sentAt: z.iso.datetime().nullable(),
  decision: z
    .object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      method: z.enum(['CUSTOMER_APP', 'APPROVAL_LINK']),
      comment: z.string().nullable(),
      decidedAt: z.iso.datetime(),
    })
    .nullable(),
  rowVersion: z.number().int(),
});
export type Estimate = z.infer<typeof EstimateSchema>;

export const SentEstimateResponseSchema = z.object({
  estimate: EstimateSchema,
  /** Shown once to the sender to share with the customer. */
  approvalLink: z.object({ token: z.string(), expiresAt: z.iso.datetime() }),
});
export type SentEstimateResponse = z.infer<typeof SentEstimateResponseSchema>;

/** What a customer (or link holder) sees: no internal identifiers beyond the job number. */
export const CustomerEstimateSchema = EstimateSchema.omit({ rowVersion: true, jobId: true }).extend(
  {
    jobNumber: z.string(),
    businessName: z.string(),
    device: z.string(),
  },
);
export type CustomerEstimate = z.infer<typeof CustomerEstimateSchema>;

/** Wording shown wherever tax would appear until tax is configured (ADR 0014). */
export const TAX_NOT_CONFIGURED_NOTE = 'Taxes, if applicable, to be confirmed.';
