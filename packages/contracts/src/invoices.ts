import { z } from 'zod';

import { ESTIMATE_LINE_TYPES } from './estimates.js';
import { MoneyStringSchema, QuantityStringSchema } from './money.js';

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const PAYMENT_STATES = ['UNPAID', 'PARTLY_PAID', 'PAID', 'CREDITED'] as const;

export const InvoiceLineInputSchema = z.object({
  lineType: z.enum(ESTIMATE_LINE_TYPES),
  description: z.string().trim().min(1).max(500),
  quantity: QuantityStringSchema,
  unit: z.string().trim().min(1).max(20).default('NOS'),
  unitPrice: MoneyStringSchema,
  discount: MoneyStringSchema.default('0'),
  /** Overrides the line type's category (must exist in the tax settings). */
  taxCategory: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/)
    .optional(),
});
export type InvoiceLineInput = z.infer<typeof InvoiceLineInputSchema>;

export const UpdateInvoiceDraftSchema = z.object({
  rowVersion: z.number().int().min(1),
  lines: z.array(InvoiceLineInputSchema).min(1, 'Add at least one line').max(100),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const CreditNoteRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    /** Whole invoice (cancellation) or selected lines and quantities. */
    full: z.boolean().default(false),
    lines: z
      .array(z.object({ invoiceLineId: z.uuid(), quantity: QuantityStringSchema }))
      .max(100)
      .default([]),
  })
  .refine((v) => v.full || v.lines.length > 0, {
    path: ['lines'],
    message: 'Choose lines to credit or credit the whole invoice',
  });
export type CreditNoteRequest = z.infer<typeof CreditNoteRequestSchema>;

export const AllocationRequestSchema = z.object({ paymentId: z.uuid(), amount: MoneyStringSchema });
export const ReleaseAllocationSchema = z.object({ reason: z.string().trim().min(3).max(500) });

const PartySchema = z.object({
  name: z.string(),
  gstin: z.string().nullable(),
  address: z.string(),
  stateCode: z.string(),
  stateName: z.string(),
});

export const InvoiceLineSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  lineType: z.enum(ESTIMATE_LINE_TYPES),
  description: z.string(),
  hsnSac: z.string(),
  quantity: z.string(),
  unit: z.string(),
  unitPrice: z.string(),
  discount: z.string(),
  taxableValue: z.string(),
  taxCategory: z.string(),
  gstRate: z.string(),
  cgstRate: z.string(),
  sgstRate: z.string(),
  igstRate: z.string(),
  cgstAmount: z.string(),
  sgstAmount: z.string(),
  igstAmount: z.string(),
  lineTotal: z.string(),
  creditedQuantity: z.string(),
});

export const InvoiceSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  jobNumber: z.string(),
  branchId: z.uuid(),
  customerId: z.uuid(),
  invoiceNumber: z.string().nullable(),
  financialYear: z.string().nullable(),
  status: z.enum(INVOICE_STATUSES),
  invoiceDate: z.string().nullable(),
  currency: z.string(),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']),
  placeOfSupply: z.object({ code: z.string(), name: z.string() }),
  reverseCharge: z.boolean(),
  supplier: PartySchema.nullable(),
  recipient: PartySchema,
  lines: z.array(InvoiceLineSchema),
  taxableTotal: z.string(),
  cgstTotal: z.string(),
  sgstTotal: z.string(),
  igstTotal: z.string(),
  taxTotal: z.string(),
  roundOff: z.string(),
  total: z.string(),
  creditedTotal: z.string(),
  paidTotal: z.string(),
  balance: z.string(),
  paymentState: z.enum(PAYMENT_STATES),
  amountInWords: z.string(),
  notes: z.string().nullable(),
  rowVersion: z.number().int(),
  issuedAt: z.iso.datetime().nullable(),
  creditNotes: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      date: z.string(),
      reason: z.string(),
      total: z.string(),
    }),
  ),
  allocations: z.array(
    z.object({
      id: z.uuid(),
      paymentId: z.uuid(),
      receiptNumber: z.string(),
      amount: z.string(),
      createdAt: z.iso.datetime(),
      releasedAt: z.iso.datetime().nullable(),
      releaseReason: z.string().nullable(),
    }),
  ),
  /** Draft only: why it cannot be issued yet (configuration), else []. */
  blockers: z.array(z.string()),
});
export type Invoice = z.infer<typeof InvoiceSchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const InvoiceSummarySchema = z.object({
  id: z.uuid(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  status: z.enum(INVOICE_STATUSES),
  jobId: z.uuid(),
  jobNumber: z.string(),
  customerName: z.string(),
  recipientGstin: z.string().nullable(),
  taxableTotal: z.string(),
  taxTotal: z.string(),
  total: z.string(),
  creditedTotal: z.string(),
  balance: z.string(),
  paymentState: z.enum(PAYMENT_STATES),
});
export type InvoiceSummary = z.infer<typeof InvoiceSummarySchema>;

export const GstSummarySchema = z.object({
  currency: z.string(),
  from: z.string(),
  to: z.string(),
  invoices: z.object({
    count: z.number().int(),
    taxable: z.string(),
    cgst: z.string(),
    sgst: z.string(),
    igst: z.string(),
    total: z.string(),
  }),
  creditNotes: z.object({
    count: z.number().int(),
    taxable: z.string(),
    cgst: z.string(),
    sgst: z.string(),
    igst: z.string(),
    total: z.string(),
  }),
  net: z.object({
    taxable: z.string(),
    cgst: z.string(),
    sgst: z.string(),
    igst: z.string(),
    total: z.string(),
  }),
  /** Registered recipients (B2B) vs unregistered (B2C). */
  bySegment: z.array(
    z.object({
      segment: z.enum(['B2B', 'B2C']),
      count: z.number().int(),
      taxable: z.string(),
      tax: z.string(),
    }),
  ),
  byRate: z.array(
    z.object({
      gstRate: z.string(),
      taxable: z.string(),
      cgst: z.string(),
      sgst: z.string(),
      igst: z.string(),
    }),
  ),
  byHsn: z.array(
    z.object({
      hsnSac: z.string(),
      gstRate: z.string(),
      quantity: z.string(),
      taxable: z.string(),
      cgst: z.string(),
      sgst: z.string(),
      igst: z.string(),
    }),
  ),
});
export type GstSummary = z.infer<typeof GstSummarySchema>;

/** Customer-safe invoice listing (issued invoices of the signed-in customer only). */
export const CustomerInvoiceSchema = z.object({
  id: z.uuid(),
  invoiceNumber: z.string(),
  invoiceDate: z.string(),
  jobNumber: z.string(),
  currency: z.string(),
  total: z.string(),
  creditedTotal: z.string(),
  balance: z.string(),
  status: z.enum(['ISSUED', 'CANCELLED']),
  creditNotes: z.array(
    z.object({ id: z.uuid(), number: z.string(), date: z.string(), total: z.string() }),
  ),
});
export type CustomerInvoice = z.infer<typeof CustomerInvoiceSchema>;
