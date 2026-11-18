import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@icon/database';

import { PRISMA } from '../prisma/prisma.service.js';
import type { HealthIndicator } from './health-indicator.js';

/** PostgreSQL readiness probe through the shared Prisma client. */
@Injectable()
export class DatabaseHealthIndicator implements HealthIndicator {
  readonly name = 'database';

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async check(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  }
}
