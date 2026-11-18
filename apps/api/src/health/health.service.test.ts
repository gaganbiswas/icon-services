import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HealthIndicator } from './health-indicator.js';
import { HealthService, describeError } from './health.service.js';

const indicator = (name: string, check: () => Promise<boolean>): HealthIndicator => ({
  name,
  check,
});

describe('HealthService.readiness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok when every indicator is up', async () => {
    const service = new HealthService([
      indicator('database', () => Promise.resolve(true)),
      indicator('redis', () => Promise.resolve(true)),
    ]);
    await expect(service.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('reports error when an indicator returns false', async () => {
    const service = new HealthService([
      indicator('database', () => Promise.resolve(true)),
      indicator('redis', () => Promise.resolve(false)),
    ]);
    await expect(service.readiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('treats a thrown error as down without exposing or logging the message', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new HealthService([
      indicator('database', () => Promise.reject(new Error('password=hunter2 rejected'))),
    ]);
    const result = await service.readiness();
    expect(result).toEqual({ status: 'error', checks: { database: 'down' } });
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('hunter2');
  });

  it('treats a hung check as down after the timeout', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new HealthService([
      indicator('database', () => new Promise<boolean>(() => undefined)),
    ]);
    await expect(service.readiness(20)).resolves.toEqual({
      status: 'error',
      checks: { database: 'down' },
    });
  });
});

describe('describeError', () => {
  it('returns the error class and a well-formed code only', () => {
    const error = Object.assign(new Error('connect to secret-host:5432 failed'), {
      code: 'ECONNREFUSED',
    });
    expect(describeError(error)).toBe('Error (ECONNREFUSED)');
  });

  it('ignores codes that could carry arbitrary text', () => {
    const error = Object.assign(new TypeError('x'), { code: 'user=admin password=x' });
    expect(describeError(error)).toBe('TypeError');
  });

  it('handles non-error rejections', () => {
    expect(describeError('password')).toBe('non-error rejection');
  });
});
