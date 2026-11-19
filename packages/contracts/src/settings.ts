import { z } from 'zod';

/**
 * Number template tokens: {BRANCH} branch code, {YYYY} year, {YY} 2-digit year,
 * {SEQ:n} zero-padded sequence (n = 1–10). Must contain exactly one {SEQ:n}.
 */
export const NumberFormatSchema = z
  .object({
    template: z
      .string()
      .min(5)
      .max(60)
      .regex(
        /^(?:[A-Z0-9/_-]|\{BRANCH\}|\{YYYY\}|\{YY\}|\{SEQ:(?:[1-9]|10)\})+$/,
        'Unsupported characters or tokens',
      )
      .refine(
        (t) => (t.match(/\{SEQ:/g) ?? []).length === 1,
        'Template must contain exactly one {SEQ:n}',
      ),
    reset: z.enum(['YEARLY', 'NEVER']),
  })
  .refine((v) => v.reset !== 'YEARLY' || /\{YYYY\}|\{YY\}/.test(v.template), {
    message: 'Yearly reset requires {YYYY} or {YY} in the template',
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
  /** Footer on payment receipts (PLACEHOLDER until accountant confirms, C27a). */
  receiptFooter: z.string().min(1).max(1000),
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
      } as NotificationSettings['templates'],
      quietHours: null as NotificationSettings['quietHours'],
    },
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
      receiptFooter: 'Tax treatment of this payment to be confirmed.',
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
  values: { sequence: bigint | number; year: number; branchCode?: string },
): string {
  return template
    .replace('{BRANCH}', values.branchCode ?? '')
    .replace('{YYYY}', String(values.year))
    .replace('{YY}', String(values.year % 100).padStart(2, '0'))
    .replace(/\{SEQ:(\d+)\}/, (_, width: string) =>
      String(values.sequence).padStart(Number(width), '0'),
    );
}
