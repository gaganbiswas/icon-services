import { z } from 'zod';

/** Outcome of a single dependency check. */
export const HealthCheckStatusSchema = z.enum(['up', 'down']);
export type HealthCheckStatus = z.infer<typeof HealthCheckStatusSchema>;

/** Response of `GET /api/v1/health/live` — the process is running. */
export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
});
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

/**
 * Response of `GET /api/v1/health/ready`.
 * Only check names and up/down are exposed — never error messages,
 * hostnames or credentials.
 */
export const ReadinessResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string().min(1), HealthCheckStatusSchema),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
