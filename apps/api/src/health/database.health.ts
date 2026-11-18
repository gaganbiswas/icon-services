import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { HealthIndicator } from './health-indicator.js';

/**
 * PostgreSQL readiness probe using a tiny dedicated pool.
 * Phase 2 replaces this with the Prisma client once the schema exists.
 */
@Injectable()
export class DatabaseHealthIndicator implements HealthIndicator, OnModuleDestroy {
  readonly name = 'database';
  private readonly pool: pg.Pool;

  constructor(@Inject(APP_ENV) env: Env) {
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    // Idle-client errors must not crash the process; the next check reports down.
    this.pool.on('error', () => undefined);
  }

  async check(): Promise<boolean> {
    const result = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
