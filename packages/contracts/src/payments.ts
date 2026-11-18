import { z } from 'zod';

import { MoneyStringSchema } from './money.js';

export const PAYMENT_METHODS = [
  'CASH',
  'UPI',
  'BANK_TRANSFER',
  'CARD_TERMINAL',
  'CHEQUE',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CARD_TERMINAL: 'Card (terminal)',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

/** Luhn check — used only to *reject* references that look like card numbers. */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const PositiveMoney = MoneyStringSchema.refine(
  (v) => /[1-9]/.test(v),
  'Amount must be greater than zero',
);

/** Transaction reference (UTR, cheque no., terminal slip no.). Never card numbers or secrets. */
export const PaymentReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (v) => !looksLikeCardNumber(v),
    'Do not enter card numbers. Use the terminal slip or authorisation number instead.',
  );

const requiresReference = (method: PaymentMethod) => method !== 'CASH';

export const RecordPaymentSchema = z
  .object({
    branchId: z.uuid(),
    customerId: z.uuid(),
    jobId: z.uuid().optional(),
    amount: PositiveMoney,
    method: z.enum(PAYMENT_METHODS),
    reference: PaymentReferenceSchema.optional(),
    /** Defaults to now; may be back-dated up to 30 days, never in the future. */
    receivedAt: z.iso.datetime().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => !requiresReference(v.method) || v.reference !== undefined, {
    message: 'A transaction reference is required for this payment method',
    path: ['reference'],
  });
export type RecordPayment = z.infer<typeof RecordPaymentSchema>;

export const RefundSchema = z
  .object({
    amount: PositiveMoney,
    method: z.enum(PAYMENT_METHODS),
    reference: PaymentReferenceSchema.optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((v) => !requiresReference(v.method) || v.reference !== undefined, {
    message: 'A transaction reference is required for this refund method',
    path: ['reference'],
  });
export type RefundRequest = z.infer<typeof RefundSchema>;

export const ReversalSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const PaymentSchema = z.object({
  id: z.uuid(),
  receiptNumber: z.string(),
  branchId: z.uuid(),
  customer: z.object({ id: z.uuid(), name: z.string(), customerCode: z.string() }),
  jobId: z.uuid().nullable(),
  jobNumber: z.string().nullable(),
  currency: z.string(),
  amount: z.string(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  receivedAt: z.iso.datetime(),
  receivedBy: z.object({ id: z.uuid(), fullName: z.string() }),
  notes: z.string().nullable(),
  status: z.enum(['RECORDED', 'REVERSED']),
  allocated: z.string(),
  refunded: z.string(),
  /** amount − allocated − refunded (0 when reversed). */
  onAccount: z.string(),
  reversal: z.object({ reason: z.string(), at: z.iso.datetime() }).nullable(),
  refunds: z.array(
    z.object({
      id: z.uuid(),
      refundNumber: z.string(),
      amount: z.string(),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().nullable(),
      reason: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const CustomerAccountSchema = z.object({
  currency: z.string().nullable(),
  received: z.string(),
  refunded: z.string(),
  allocated: z.string(),
  onAccount: z.string(),
  paymentCount: z.number().int(),
});
export type CustomerAccount = z.infer<typeof CustomerAccountSchema>;

export const CollectionsReportSchema = z.object({
  currency: z.string().nullable(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  received: z.string(),
  refunded: z.string(),
  net: z.string(),
  byMethod: z.array(
    z.object({
      method: z.enum(PAYMENT_METHODS),
      received: z.string(),
      refunded: z.string(),
      count: z.number().int(),
    }),
  ),
  byCashier: z.array(
    z.object({
      user: z.object({ id: z.uuid(), fullName: z.string() }),
      received: z.string(),
      count: z.number().int(),
    }),
  ),
});
export type CollectionsReport = z.infer<typeof CollectionsReportSchema>;

/** Customer-safe receipt listing. */
export const CustomerPaymentSchema = z.object({
  id: z.uuid(),
  receiptNumber: z.string(),
  jobNumber: z.string().nullable(),
  currency: z.string(),
  amount: z.string(),
  method: z.enum(PAYMENT_METHODS),
  receivedAt: z.iso.datetime(),
  status: z.enum(['RECORDED', 'REVERSED']),
});
export type CustomerPayment = z.infer<typeof CustomerPaymentSchema>;
