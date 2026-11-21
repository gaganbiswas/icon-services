import { z } from 'zod';

import { isValidGstin, stateName } from './india.js';

/**
 * Number template tokens: {BRANCH} branch code, {YYYY} year, {YY} 2-digit year,
 * {FY} financial year "2026-27", {FYS} short financial year "2627",
 * {SEQ:n} zero-padded sequence (n = 1–10). Must contain exactly one {SEQ:n}.
 */
export const NumberFormatSchema = z
  .object({
    template: z
      .string()
      .min(5)
      .max(60)
      .regex(
        /^(?:[A-Z0-9/_-]|\{BRANCH\}|\{YYYY\}|\{YY\}|\{FYS?\}|\{SEQ:(?:[1-9]|10)\})+$/,
        'Unsupported characters or tokens',
      )
      .refine(
        (t) => (t.match(/\{SEQ:/g) ?? []).length === 1,
        'Template must contain exactly one {SEQ:n}',
      ),
    reset: z.enum(['YEARLY', 'FINANCIAL_YEAR', 'NEVER']),
  })
  .refine((v) => v.reset !== 'YEARLY' || /\{YYYY\}|\{YY\}/.test(v.template), {
    message: 'Yearly reset requires {YYYY} or {YY} in the template',
    path: ['template'],
  })
  .refine((v) => v.reset !== 'FINANCIAL_YEAR' || /\{FYS?\}/.test(v.template), {
    message: 'Financial-year reset requires {FY} or {FYS} in the template',
    path: ['template'],
  });
export type NumberFormat = z.infer<typeof NumberFormatSchema>;

export const DocumentSettingsSchema = z.object({
  /** Printed under the business name. Empty until the owner provides details (H57). */
  businessHeader: z.string().max(500),
  /** Job receipt terms (H58). PLACEHOLDER until confirmed. */
  jobReceiptTerms: z.string().min(1).max(4000),
});
export type DocumentSettings = z.infer<typeof DocumentSettingsSchema>;

export const PrivacySettingsSchema = z.object({
  /** Version of the consent/privacy wording customers agree to (G54). */
  consentPolicyVersion: z.string().min(1).max(50),
});

export const MoneySettingsSchema = z.object({
  /** ISO 4217; null until the owner confirms (question B11). Never assumed. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
});

export const EstimateSettingsSchema = z.object({
  validityDays: z.number().int().min(1).max(90),
  /** Terms shown with every estimate (PLACEHOLDER until supplied, H59). */
  terms: z.string().min(1).max(4000),
});

const StateCodeSchema = z.string().refine((c) => stateName(c) !== null, 'Unknown state code');
const DecimalString = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Use a percentage such as 18 or 2.5');

/** Business details printed on invoices and documents (ADR 0021). Configuration, never code. */
export const BusinessProfileSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().max(200).nullable(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidGstin, 'Not a valid GSTIN (format or check digit)')
    .nullable(),
  address: z.object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).nullable(),
    city: z.string().trim().min(1).max(100),
    stateCode: StateCodeSchema,
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Six-digit PIN code'),
  }),
  phones: z.array(z.string().trim().min(6).max(20)).max(6),
  emails: z.array(z.email()).max(4),
  website: z.string().trim().max(200).nullable(),
  signatoryName: z.string().trim().max(200).nullable(),
  signatoryDesignation: z.string().trim().max(100).nullable(),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const ESTIMATE_LINE_TYPES_FOR_TAX = ['LABOUR', 'PART', 'SERVICE_FEE', 'OTHER'] as const;

export const TaxCategorySchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  name: z.string().trim().min(1).max(100),
  /** HSN (goods) or SAC (services) code, 4–8 digits. */
  hsnSac: z.string().regex(/^\d{4,8}$/, '4 to 8 digits'),
  /** Effective-dated rates; the rate in force on the invoice date applies. */
  rates: z
    .array(z.object({ ratePercent: DecimalString, effectiveFrom: z.iso.date() }))
    .min(1)
    .refine(
      (r) => new Set(r.map((x) => x.effectiveFrom)).size === r.length,
      'Duplicate effective dates',
    ),
});
export type TaxCategory = z.infer<typeof TaxCategorySchema>;

/** GST configuration (ADR 0022). Invoices can be issued only when status is APPROVED. */
export const TaxSettingsSchema = z
  .object({
    status: z.enum(['DRAFT', 'APPROVED']),
    /** Who approved it (e.g. accountant's name) and when — required when APPROVED. */
    approval: z
      .object({
        approvedBy: z.string().trim().min(2).max(200),
        approvedOn: z.iso.date(),
        note: z.string().trim().max(500).nullable(),
      })
      .nullable(),
    pricing: z.enum(['TAX_EXCLUSIVE']),
    roundOff: z.enum(['NEAREST_RUPEE', 'NONE']),
    categories: z.array(TaxCategorySchema).min(1).max(30),
    /** Category used for each estimate/invoice line type (a part's own category overrides PART). */
    lineTypeCategory: z.record(z.enum(ESTIMATE_LINE_TYPES_FOR_TAX), z.string()),
  })
  .refine((t) => t.status !== 'APPROVED' || t.approval !== null, {
    path: ['approval'],
    message: 'Record who approved the tax configuration',
  })
  .refine(
    (t) => Object.values(t.lineTypeCategory).every((c) => t.categories.some((k) => k.code === c)),
    {
      path: ['lineTypeCategory'],
      message: 'Every line type must map to a defined category',
    },
  )
  .refine((t) => new Set(t.categories.map((c) => c.code)).size === t.categories.length, {
    path: ['categories'],
    message: 'Duplicate category codes',
  });
export type TaxSettings = z.infer<typeof TaxSettingsSchema>;

export const InvoicingSettingsSchema = z.object({
  financialYearStartMonth: z.number().int().min(1).max(12),
  /** Printed on every invoice (PLACEHOLDER until supplied). */
  terms: z.string().trim().min(1).max(2000),
  /** Optional declaration line printed above the signature. */
  declaration: z.string().trim().max(500).nullable(),
});
export type InvoicingSettings = z.infer<typeof InvoicingSettingsSchema>;

/** Events customers can be notified about (ADR 0013/0018). */
export const NOTIFICATION_EVENTS = [
  'JOB_RECEIVED',
  'JOB_STATUS_CHANGED',
  'JOB_UPDATE_POSTED',
  'REPAIR_COMPLETED',
  'READY_FOR_DELIVERY',
  'ESTIMATE_READY',
  'ESTIMATE_DECISION_RECORDED',
  'PAYMENT_RECEIVED',
  'DELIVERY_CONFIRMED',
  'INVOICE_ISSUED',
] as const;
export type NotificationEventName = (typeof NOTIFICATION_EVENTS)[number];

const TemplateRefSchema = z.object({
  /** Approved Meta template name. */
  name: z
    .string()
    .regex(
      /^[a-z0-9_]{1,512}$/,
      'Use the exact approved template name (lower-case, digits, underscores)',
    ),
  /** Template language code as approved, e.g. en, en_US, hi. */
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
});

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

export const NotificationSettingsSchema = z.object({
  /** Per event: approved WhatsApp template (null = not configured) and email subject (null = no email). */
  templates: z.record(
    z.enum(NOTIFICATION_EVENTS),
    z.object({
      whatsapp: TemplateRefSchema.nullable(),
      emailSubject: z.string().min(1).max(200).nullable(),
    }),
  ),
  /** Optional quiet hours in the organization time zone; null = off. */
  quietHours: z.object({ start: TimeSchema, end: TimeSchema }).nullable(),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const DeliverySettingsSchema = z.object({
  /** Printed on delivery challans (PLACEHOLDER until supplied, H59). */
  challanTerms: z.string().min(1).max(2000),
});

export const PaymentSettingsSchema = z.object({
  /** Enabled payment methods (owner question D38). */
  methods: z
    .array(z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD_TERMINAL', 'CHEQUE', 'OTHER']))
    .min(1),
  /** Optional footer on payment receipts; empty = none (owner: no receipt voucher wording, ADR 0024). */
  receiptFooter: z.string().max(1000),
});

export const PhoneSettingsSchema = z.object({
  /** ISO 3166-1 region used when a number has no country code; null = require +country. */
  defaultRegion: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
});

/** Registry of setting keys → schema and PLACEHOLDER defaults (ADR 0012). */
export const SETTINGS = {
  'numbering.jobNumber': {
    schema: NumberFormatSchema,
    default: { template: '{BRANCH}-{YYYY}-{SEQ:6}', reset: 'YEARLY' } satisfies NumberFormat,
  },
  'numbering.customerCode': {
    schema: NumberFormatSchema,
    default: { template: 'C{SEQ:6}', reset: 'NEVER' } satisfies NumberFormat,
  },
  documents: {
    schema: DocumentSettingsSchema,
    default: {
      businessHeader: '',
      jobReceiptTerms: 'Terms and conditions to be confirmed by the business.',
    } satisfies DocumentSettings,
  },
  privacy: {
    schema: PrivacySettingsSchema,
    default: { consentPolicyVersion: 'UNCONFIRMED-DRAFT' },
  },
  money: {
    schema: MoneySettingsSchema,
    default: { currency: null as string | null },
  },
  estimates: {
    schema: EstimateSettingsSchema,
    default: {
      validityDays: 14,
      terms:
        'Estimate terms to be confirmed by the business. Prices exclude any applicable taxes, which will be confirmed.',
    },
  },
  'numbering.receiptNumber': {
    schema: NumberFormatSchema,
    default: { template: 'RCPT-{BRANCH}-{YYYY}-{SEQ:6}', reset: 'YEARLY' } satisfies NumberFormat,
  },
  'numbering.refundNumber': {
    schema: NumberFormatSchema,
    default: { template: 'RFD-{BRANCH}-{YYYY}-{SEQ:6}', reset: 'YEARLY' } satisfies NumberFormat,
  },
  'numbering.challanNumber': {
    schema: NumberFormatSchema,
    default: { template: 'DC-{BRANCH}-{YYYY}-{SEQ:6}', reset: 'YEARLY' } satisfies NumberFormat,
  },
  notifications: {
    schema: NotificationSettingsSchema,
    default: {
      // WhatsApp templates must be approved by Meta before use (PLACEHOLDER: none configured).
      templates: {
        JOB_RECEIVED: { whatsapp: null, emailSubject: 'We have received your service request' },
        JOB_STATUS_CHANGED: { whatsapp: null, emailSubject: 'Update on your service request' },
        JOB_UPDATE_POSTED: { whatsapp: null, emailSubject: 'Update on your service request' },
        REPAIR_COMPLETED: { whatsapp: null, emailSubject: 'Your repair is complete' },
        READY_FOR_DELIVERY: { whatsapp: null, emailSubject: 'Your device is ready' },
        ESTIMATE_READY: { whatsapp: null, emailSubject: 'Your repair estimate is ready' },
        ESTIMATE_DECISION_RECORDED: {
          whatsapp: null,
          emailSubject: 'We have recorded your estimate decision',
        },
        PAYMENT_RECEIVED: { whatsapp: null, emailSubject: 'Payment received' },
        DELIVERY_CONFIRMED: { whatsapp: null, emailSubject: 'Your device has been handed over' },
        INVOICE_ISSUED: { whatsapp: null, emailSubject: 'Your invoice' },
      } as NotificationSettings['templates'],
      quietHours: null as NotificationSettings['quietHours'],
    },
  },
  'numbering.invoiceNumber': {
    schema: NumberFormatSchema,
    // Owner format MT/<number>, restarting each April with the year in it (ADR 0024); ≤ 16 characters (GST).
    default: { template: 'MT/{FYS}/{SEQ:1}', reset: 'FINANCIAL_YEAR' } satisfies NumberFormat,
  },
  'numbering.billOfSupplyNumber': {
    schema: NumberFormatSchema,
    default: { template: 'BS/{FYS}/{SEQ:1}', reset: 'FINANCIAL_YEAR' } satisfies NumberFormat,
  },
  'numbering.creditNoteNumber': {
    schema: NumberFormatSchema,
    default: { template: 'CN/{FYS}/{SEQ:1}', reset: 'FINANCIAL_YEAR' } satisfies NumberFormat,
  },
  business: {
    schema: BusinessProfileSchema.nullable(),
    /** Not configured until entered in the admin panel (never sample or assumed data). */
    default: null as BusinessProfile | null,
  },
  tax: {
    schema: TaxSettingsSchema,
    default: {
      // SUGGESTED, NOT APPROVED (ADR 0022): review with the accountant, then approve in the admin panel.
      status: 'DRAFT',
      approval: null,
      pricing: 'TAX_EXCLUSIVE',
      roundOff: 'NEAREST_RUPEE',
      categories: [
        {
          code: 'SERVICE',
          name: 'Repair and maintenance services',
          hsnSac: '998713',
          rates: [{ ratePercent: '18', effectiveFrom: '2017-07-01' }],
        },
        {
          code: 'PARTS',
          name: 'Computer parts and accessories',
          hsnSac: '8473',
          rates: [{ ratePercent: '18', effectiveFrom: '2017-07-01' }],
        },
      ],
      lineTypeCategory: {
        LABOUR: 'SERVICE',
        PART: 'PARTS',
        SERVICE_FEE: 'SERVICE',
        OTHER: 'SERVICE',
      },
    } as TaxSettings,
  },
  invoicing: {
    schema: InvoicingSettingsSchema,
    default: {
      financialYearStartMonth: 4,
      terms: 'Invoice terms to be confirmed by the business.',
      declaration: null,
    } as InvoicingSettings,
  },
  delivery: {
    schema: DeliverySettingsSchema,
    default: { challanTerms: 'Delivery terms to be confirmed by the business.' },
  },
  payments: {
    schema: PaymentSettingsSchema,
    default: {
      methods: ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD_TERMINAL', 'CHEQUE', 'OTHER'] as (
        'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD_TERMINAL' | 'CHEQUE' | 'OTHER'
      )[],
      receiptFooter: '',
    },
  },
  phone: {
    schema: PhoneSettingsSchema,
    default: { defaultRegion: null as string | null },
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** Formats a number from a template. Pure; used by the API and tests. */
export function formatNumber(
  template: string,
  values: {
    sequence: bigint | number;
    year: number;
    branchCode?: string;
    fy?: { label: string; short: string };
  },
): string {
  return template
    .replace('{BRANCH}', values.branchCode ?? '')
    .replace('{FYS}', values.fy?.short ?? '')
    .replace('{FY}', values.fy?.label ?? '')
    .replace('{YYYY}', String(values.year))
    .replace('{YY}', String(values.year % 100).padStart(2, '0'))
    .replace(/\{SEQ:(\d+)\}/, (_, width: string) =>
      String(values.sequence).padStart(Number(width), '0'),
    );
}
