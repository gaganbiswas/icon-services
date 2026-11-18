import { Inject, Injectable, Logger } from '@nestjs/common';
import type { HealthCheckStatus, ReadinessResponse } from '@icon/contracts';

import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator.js';

export const DEFAULT_CHECK_TIMEOUT_MS = 3_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(HEALTH_INDICATORS) private readonly indicators: readonly HealthIndicator[]) {}

  /** Runs every indicator in parallel; any failure or timeout marks it down. */
  async readiness(timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS): Promise<ReadinessResponse> {
    const entries = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, HealthCheckStatus]> => [
        indicator.name,
        await this.runCheck(indicator, timeoutMs),
      ]),
    );
    const checks = Object.fromEntries(entries);
    const status = entries.every(([, value]) => value === 'up') ? 'ok' : 'error';
    return { status, checks };
  }

  private async runCheck(
    indicator: HealthIndicator,
    timeoutMs: number,
  ): Promise<HealthCheckStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CheckTimeoutError()), timeoutMs);
    });
    try {
      const healthy = await Promise.race([indicator.check(), timeout]);
      return healthy ? 'up' : 'down';
    } catch (error) {
      // Log only the error class and code. Driver messages can contain
      // connection details, so they are never logged or returned (CLAUDE.md §11.14).
      this.logger.warn(`Readiness check "${indicator.name}" failed: ${describeError(error)}`);
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}

class CheckTimeoutError extends Error {
  override readonly name = 'CheckTimeoutError';
}

/** Safe, non-sensitive description of a failure: error class and code only. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'non-error rejection';
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)
    ? `${error.name} (${code})`
    : error.name;
}
