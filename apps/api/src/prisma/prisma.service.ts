import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type PrismaClient, createPrismaClient } from '@icon/database';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/** DI token for the shared Prisma client. */
export const PRISMA = Symbol('PRISMA');

@Injectable()
export class PrismaLifecycle implements OnModuleDestroy {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const prismaProvider = {
  provide: PRISMA,
  inject: [APP_ENV],
  useFactory: (env: Env): PrismaClient => createPrismaClient({ databaseUrl: env.DATABASE_URL }),
};
