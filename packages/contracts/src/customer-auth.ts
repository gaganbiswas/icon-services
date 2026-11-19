import { z } from 'zod';

import { PhoneInputSchema } from './customers.js';

export const OtpRequestSchema = z.object({
  organizationCode: z.string().trim().min(1).max(20),
  phone: PhoneInputSchema,
});
export type OtpRequest = z.infer<typeof OtpRequestSchema>;

export const OtpRequestResponseSchema = z.object({
  /** Always returned, whether or not the number is known (no enumeration). */
  sent: z.literal(true),
  expiresInSeconds: z.number().int(),
});

export const OtpVerifyRequestSchema = z.object({
  organizationCode: z.string().trim().min(1).max(20),
  phone: PhoneInputSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  /** Required only when no customer exists for this number yet. */
  fullName: z.string().trim().min(1).max(200).optional(),
});
export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequestSchema>;

export const CustomerTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  refreshExpiresAt: z.iso.datetime(),
});
export type CustomerTokenResponse = z.infer<typeof CustomerTokenResponseSchema>;

export const CustomerRefreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(100),
});

export const CustomerProfileSchema = z.object({
  id: z.uuid(),
  customerCode: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  organization: z.object({ code: z.string(), displayName: z.string() }),
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

/** Web portal: the refresh token stays in an HttpOnly cookie and is never returned to scripts. */
export const CustomerWebTokenResponseSchema = CustomerTokenResponseSchema.omit({
  refreshToken: true,
});
export type CustomerWebTokenResponse = z.infer<typeof CustomerWebTokenResponseSchema>;
