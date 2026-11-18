import { z } from 'zod';

import { AddressSchema } from './customers.js';

export const DELIVERY_MODES = [
  'CUSTOMER_PICKUP',
  'HOME_DELIVERY',
  'ON_SITE_RETURN',
  'OTHER',
] as const;
export const RECIPIENT_RELATIONSHIPS = [
  'SELF',
  'AUTHORIZED_PERSON',
  'FAMILY',
  'COLLEAGUE',
  'OTHER',
] as const;
export const PROOF_METHODS = ['SIGNED_CHALLAN', 'PHOTO_PROOF'] as const;

/** Default hand-over checklist (configurable later). */
export const HANDOVER_CHECKLIST = [
  'Device tested in front of the recipient',
  'Recipient checked accessories',
  'Customer data / passwords discussed',
] as const;

export const DispatchSchema = z.object({
  version: z.number().int().min(1),
  mode: z.enum(['HOME_DELIVERY', 'OTHER']),
  address: AddressSchema,
  notes: z.string().trim().max(500).optional(),
});
export type DispatchRequest = z.infer<typeof DispatchSchema>;

export const HandoverItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  returned: z.boolean(),
  condition: z.string().trim().max(300).optional(),
});

export const HandoverSchema = z
  .object({
    version: z.number().int().min(1),
    /** Required when no dispatch exists (pickup / on-site return). */
    mode: z.enum(DELIVERY_MODES).optional(),
    recipientName: z.string().trim().min(1).max(200),
    relationship: z.enum(RECIPIENT_RELATIONSHIPS),
    authorizationNote: z.string().trim().max(500).optional(),
    items: z.array(HandoverItemSchema).min(1).max(40),
    checklist: z
      .array(z.object({ item: z.string().trim().min(1).max(100), checked: z.boolean() }))
      .max(20)
      .default([]),
    conditionNotes: z.string().trim().max(1000).optional(),
    proofMethod: z.enum(PROOF_METHODS),
    proofFileId: z.uuid().optional(),
    /** Required (with the override permission) when a balance is due. */
    dueOverrideReason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.relationship === 'SELF' || v.authorizationNote !== undefined, {
    message: 'Describe how the recipient is authorized to collect',
    path: ['authorizationNote'],
  })
  .refine((v) => v.proofMethod !== 'PHOTO_PROOF' || v.proofFileId !== undefined, {
    message: 'Upload the hand-over photo',
    path: ['proofFileId'],
  })
  .refine((v) => v.items.every((i) => i.returned), {
    message: 'Every item must be returned (partial delivery is not enabled)',
    path: ['items'],
  });
export type HandoverRequest = z.infer<typeof HandoverSchema>;

export const FailedAttemptSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const BalanceSchema = z.object({
  currency: z.string().nullable(),
  /** Interim: approved estimate customer-payable (Phase 7: invoice total). */
  billed: z.string(),
  paid: z.string(),
  due: z.string(),
  basis: z.enum(['APPROVED_ESTIMATE', 'NONE']),
});
export type Balance = z.infer<typeof BalanceSchema>;

export const DeliverySchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  jobNumber: z.string(),
  challanNumber: z.string(),
  mode: z.enum(DELIVERY_MODES),
  status: z.enum(['DISPATCHED', 'COMPLETED', 'FAILED']),
  address: z.unknown().nullable(),
  recipientName: z.string().nullable(),
  relationship: z.enum(RECIPIENT_RELATIONSHIPS).nullable(),
  authorizationNote: z.string().nullable(),
  proofMethod: z.enum(PROOF_METHODS).nullable(),
  items: z.array(
    z.object({ description: z.string(), returned: z.boolean(), condition: z.string().nullable() }),
  ),
  balance: BalanceSchema.nullable(),
  dueOverride: z.object({ reason: z.string(), approvedBy: z.uuid() }).nullable(),
  dispatchedAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  failedReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Delivery = z.infer<typeof DeliverySchema>;
