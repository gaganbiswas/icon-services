import { z } from 'zod';

import { PERMISSION_CODES } from './permissions.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Header required on cookie-authenticated auth endpoints (CSRF defence, ADR 0010). */
export const CSRF_HEADER = 'x-icon-csrf';

export const EmailSchema = z.string().trim().pipe(z.email().max(254));

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  // Do not apply the policy at login: existing passwords are verified as-is.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AccessTokenResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  mustChangePassword: z.boolean(),
  /** Privileged user without MFA: only MFA enrolment is available until done (ADR 0011). */
  mfaEnrollmentRequired: z.boolean(),
});
export type AccessTokenResponse = z.infer<typeof AccessTokenResponseSchema>;

/** Second sign-in step for users with MFA enabled (no session exists yet). */
export const MfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string(),
  expiresIn: z.number().int(),
});
export type MfaChallengeResponse = z.infer<typeof MfaChallengeResponseSchema>;
export type LoginResponse = AccessTokenResponse | MfaChallengeResponse;

export const isMfaChallenge = (r: LoginResponse): r is MfaChallengeResponse => 'mfaRequired' in r;

/** 6-digit authenticator code or a recovery code (xxxxx-xxxxx). */
export const MfaCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\d{6}|[a-z2-7]{5}-[a-z2-7]{5})$/, 'Enter the 6-digit code or a recovery code');

export const MfaVerifyRequestSchema = z.object({
  challengeToken: z.string().min(32).max(128),
  code: MfaCodeSchema,
});
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const MfaConfirmRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const MfaEnrollmentSchema = z.object({
  /** Base32 secret for manual entry; shown once. */
  secret: z.string(),
  /** otpauth:// URI for the QR code. */
  otpauthUri: z.string(),
});
export type MfaEnrollment = z.infer<typeof MfaEnrollmentSchema>;

export const MfaStatusSchema = z.object({
  enabled: z.boolean(),
  required: z.boolean(),
  recoveryCodesRemaining: z.number().int(),
});
export type MfaStatus = z.infer<typeof MfaStatusSchema>;

export const MfaResetRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: PasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const CompletePasswordSetupRequestSchema = z.object({
  token: z.string().min(32).max(128),
  newPassword: PasswordSchema,
});
export type CompletePasswordSetupRequest = z.infer<typeof CompletePasswordSetupRequestSchema>;

export const PasswordSetupTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});
export type PasswordSetupTokenResponse = z.infer<typeof PasswordSetupTokenResponseSchema>;

export const BranchSummarySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
export type BranchSummary = z.infer<typeof BranchSummarySchema>;

export const RoleSummarySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
export type RoleSummary = z.infer<typeof RoleSummarySchema>;

export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  organization: z.object({ id: z.uuid(), code: z.string(), displayName: z.string() }),
  roles: z.array(RoleSummarySchema),
  permissions: z.array(z.enum(PERMISSION_CODES as [string, ...string[]])),
  branchAccess: z.union([z.literal('ALL'), z.array(BranchSummarySchema)]),
  mustChangePassword: z.boolean(),
  mfaEnrollmentRequired: z.boolean(),
  mfaEnabled: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
