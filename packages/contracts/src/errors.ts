import { z } from 'zod';

/** Machine-readable error codes returned by the API. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'PASSWORD_CHANGE_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'CSRF_REJECTED',
  'RATE_LIMITED',
  'INVALID_TOKEN',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Standard error envelope (CLAUDE.md §7). Never contains stack traces or secrets. */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
