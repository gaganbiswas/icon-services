import { z } from 'zod';

const LOG_LEVELS = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const commaSeparatedOrigins = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })));

/**
 * Server-side environment schema. Validated once at start-up; the process
 * refuses to start on invalid configuration (fail fast).
 */
const intInRange = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_CORS_ORIGINS: commaSeparatedOrigins,
    API_DOCS_ENABLED: booleanString,
    LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Number of reverse-proxy hops to trust for client IP (0 = none). */
    HTTP_TRUST_PROXY: intInRange(0, 5, 0),

    // Authentication (ADR 0010)
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ISSUER: z.string().min(1).default('icon-service-api'),
    JWT_AUDIENCE: z.string().min(1).default('icon-service-staff'),
    ACCESS_TOKEN_TTL_SECONDS: intInRange(60, 3600, 900),
    REFRESH_TOKEN_IDLE_TTL_DAYS: intInRange(1, 30, 7),
    SESSION_ABSOLUTE_TTL_DAYS: intInRange(1, 90, 30),
    AUTH_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    LOGIN_MAX_FAILED_ATTEMPTS: intInRange(3, 20, 5),
    LOGIN_LOCKOUT_MINUTES: intInRange(1, 1440, 15),
    PASSWORD_SETUP_TOKEN_TTL_MINUTES: intInRange(5, 1440, 60),
    AUDIT_STORE_CLIENT_METADATA: booleanString,
    /** Per-IP limit for sign-in and password endpoints. */
    AUTH_RATE_LIMIT_PER_MINUTE: intInRange(1, 10_000, 10),

    // Object storage (S3-compatible; SeaweedFS locally, ADR 0009)
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'invalid bucket name'),
    S3_FORCE_PATH_STYLE: booleanString,
    SIGNED_URL_TTL_SECONDS: intInRange(30, 3600, 300),

    // Documents (ADR 0012)
    /** Optional explicit Chromium executable; otherwise Playwright's installed browser. */
    PDF_CHROMIUM_EXECUTABLE: z.string().min(1).optional(),

    // Customer sign-in (ADR 0012)
    OTP_PROVIDER: z.enum(['mock', 'whatsapp']).default('mock'),
    /** Server-side secret mixed into OTP hashes (>= 32 chars). */
    OTP_PEPPER: z.string().min(32, 'must be at least 32 characters'),
    OTP_TTL_SECONDS: intInRange(60, 900, 300),
    OTP_MAX_ATTEMPTS: intInRange(3, 10, 5),
    OTP_RESEND_INTERVAL_SECONDS: intInRange(10, 600, 30),
    CUSTOMER_JWT_AUDIENCE: z.string().min(1).default('icon-service-customer'),
    CUSTOMER_REFRESH_TOKEN_IDLE_TTL_DAYS: intInRange(1, 90, 30),
    CUSTOMER_SESSION_ABSOLUTE_TTL_DAYS: intInRange(1, 365, 90),

    // Notification providers (ADR 0018). Secrets come from the environment / secrets manager only.
    WHATSAPP_PROVIDER: z.enum(['mock', 'meta', 'disabled']).default('mock'),
    WHATSAPP_API_BASE_URL: z.url({ protocol: /^https?$/ }).default('https://graph.facebook.com'),
    /** Graph API version, e.g. v23.0 — set explicitly to the version you tested with. */
    WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .optional(),
    WHATSAPP_PHONE_NUMBER_ID: z
      .string()
      .regex(/^\d{5,30}$/)
      .optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
    /** App secret used to verify webhook signatures (X-Hub-Signature-256). */
    WHATSAPP_APP_SECRET: z.string().min(16).optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),
    /** Organization whose customers this WhatsApp number serves. */
    WHATSAPP_ORGANIZATION_CODE: z.string().min(1).optional(),
    WHATSAPP_OTP_TEMPLATE_NAME: z
      .string()
      .regex(/^[a-z0-9_]{1,512}$/)
      .optional(),
    WHATSAPP_OTP_TEMPLATE_LANGUAGE: z
      .string()
      .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/)
      .default('en'),
    EMAIL_PROVIDER: z.enum(['mock', 'smtp', 'disabled']).default('mock'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: intInRange(1, 65_535, 587),
    /** true = implicit TLS (465); false = STARTTLS when offered (587). */
    SMTP_SECURE: booleanString,
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).max(320).optional(),

    // Background worker (ADR 0013)
    NOTIFICATION_POLL_INTERVAL_MS: intInRange(250, 60_000, 2_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      (env.WHATSAPP_PROVIDER === 'mock' || env.EMAIL_PROVIDER === 'mock')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['WHATSAPP_PROVIDER'],
        message: 'mock notification providers are not allowed in production',
      });
    }
    const needsMeta = env.WHATSAPP_PROVIDER === 'meta' || env.OTP_PROVIDER === 'whatsapp';
    if (needsMeta) {
      for (const key of [
        'WHATSAPP_GRAPH_API_VERSION',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_APP_SECRET',
        'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
        'WHATSAPP_ORGANIZATION_CODE',
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required for the Meta WhatsApp provider',
          });
      }
    }
    if (env.OTP_PROVIDER === 'whatsapp' && !env.WHATSAPP_OTP_TEMPLATE_NAME) {
      ctx.addIssue({
        code: 'custom',
        path: ['WHATSAPP_OTP_TEMPLATE_NAME'],
        message: 'required when OTP_PROVIDER=whatsapp',
      });
    }
    if (env.EMAIL_PROVIDER === 'smtp') {
      for (const key of ['SMTP_HOST', 'EMAIL_FROM'] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required for EMAIL_PROVIDER=smtp',
          });
      }
    }
    if (env.NODE_ENV === 'production' && env.OTP_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PROVIDER'],
        message: 'the mock OTP provider is not allowed in production',
      });
    }
    if (env.CUSTOMER_JWT_AUDIENCE === env.JWT_AUDIENCE) {
      ctx.addIssue({
        code: 'custom',
        path: ['CUSTOMER_JWT_AUDIENCE'],
        message: 'must differ from JWT_AUDIENCE',
      });
    }
    if (env.CUSTOMER_REFRESH_TOKEN_IDLE_TTL_DAYS > env.CUSTOMER_SESSION_ABSOLUTE_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['CUSTOMER_REFRESH_TOKEN_IDLE_TTL_DAYS'],
        message: 'must not exceed CUSTOMER_SESSION_ABSOLUTE_TTL_DAYS',
      });
    }
    if (env.REFRESH_TOKEN_IDLE_TTL_DAYS > env.SESSION_ABSOLUTE_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_IDLE_TTL_DAYS'],
        message: 'must not exceed SESSION_ABSOLUTE_TTL_DAYS',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Parses and validates environment variables.
 * Error messages name the variable and the rule only — never the value,
 * because values may be secrets (CLAUDE.md §11.14).
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // "KEY=" in an env file means "not set" (placeholders in .env.example).
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = EnvSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new InvalidEnvironmentError(problems);
  }
  return result.data;
}

/** Returns the enabled log levels at or above the configured minimum. */
export function enabledLogLevels(minimum: LogLevelName): LogLevelName[] {
  return LOG_LEVELS.slice(LOG_LEVELS.indexOf(minimum));
}
