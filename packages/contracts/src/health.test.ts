import { describe, expect, it } from 'vitest';

import { LivenessResponseSchema, ReadinessResponseSchema } from './health.js';

describe('health contracts', () => {
  it('accepts a valid liveness response', () => {
    expect(LivenessResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects an unknown liveness status', () => {
    expect(LivenessResponseSchema.safeParse({ status: 'degraded' }).success).toBe(false);
  });

  it('accepts a readiness response with per-check status', () => {
    const value = { status: 'error', checks: { database: 'up', redis: 'down' } };
    expect(ReadinessResponseSchema.parse(value)).toEqual(value);
  });

  it('rejects readiness checks with unknown states', () => {
    const value = { status: 'ok', checks: { database: 'maybe' } };
    expect(ReadinessResponseSchema.safeParse(value).success).toBe(false);
  });
});
