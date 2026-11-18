import { z } from 'zod';

import { EmailSchema } from './auth.js';

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export const CONSENT_CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS', 'PUSH'] as const;
export const CONSENT_PURPOSES = ['SERVICE_UPDATES', 'MARKETING'] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const AddressSchema = z.object({
  line1: text(200),
  line2: optionalText(200),
  city: text(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
});
export type Address = z.infer<typeof AddressSchema>;

/** Raw phone input; normalized to E.164 on the server. */
export const PhoneInputSchema = z.string().trim().min(6).max(32);

export const ConsentInputSchema = z.object({
  channel: z.enum(CONSENT_CHANNELS),
  purpose: z.enum(CONSENT_PURPOSES),
});

export const CreateCustomerRequestSchema = z.object({
  type: z.enum(CUSTOMER_TYPES),
  name: text(200),
  contactPerson: optionalText(200),
  phone: PhoneInputSchema,
  altPhone: PhoneInputSchema.optional(),
  email: EmailSchema.optional(),
  taxIdentifier: optionalText(30),
  preferredLanguage: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .optional(),
  notes: optionalText(2000),
  billingAddress: AddressSchema.optional(),
  serviceAddress: AddressSchema.optional(),
  /** Consents granted at intake (recorded with the current policy version). */
  consents: z.array(ConsentInputSchema).max(8).default([]),
});
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

export const UpdateCustomerRequestSchema = CreateCustomerRequestSchema.omit({
  consents: true,
  type: true,
})
  .partial()
  .extend({
    version: z.number().int().min(1),
    billingAddress: AddressSchema.nullable().optional(),
    serviceAddress: AddressSchema.nullable().optional(),
  });
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequestSchema>;

export const ConsentSchema = z.object({
  id: z.uuid(),
  channel: z.enum(CONSENT_CHANNELS),
  purpose: z.enum(CONSENT_PURPOSES),
  policyVersion: z.string(),
  source: z.string(),
  grantedAt: z.iso.datetime(),
  withdrawnAt: z.iso.datetime().nullable(),
});
export type Consent = z.infer<typeof ConsentSchema>;

export const ChangeConsentRequestSchema = ConsentInputSchema.extend({
  granted: z.boolean(),
});
export type ChangeConsentRequest = z.infer<typeof ChangeConsentRequestSchema>;

const AddressOutSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string(),
});

export const CustomerSchema = z.object({
  id: z.uuid(),
  customerCode: z.string(),
  type: z.enum(CUSTOMER_TYPES),
  name: z.string(),
  contactPerson: z.string().nullable(),
  phone: z.string(),
  altPhone: z.string().nullable(),
  email: z.string().nullable(),
  taxIdentifier: z.string().nullable(),
  preferredLanguage: z.string().nullable(),
  notes: z.string().nullable(),
  billingAddress: AddressOutSchema.nullable(),
  serviceAddress: AddressOutSchema.nullable(),
  activeConsents: z.array(ConsentSchema),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const CustomerSearchQuerySchema = z.object({
  /** Matches name, phone, e-mail or customer code. */
  q: z.string().trim().max(100).optional(),
});
