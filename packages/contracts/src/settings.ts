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
