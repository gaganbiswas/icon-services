import { type DynamicModule, Module } from '@nestjs/common';

import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RolesModule } from './roles/roles.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * Root module. Domain modules (CLAUDE.md §3) are added phase by phase.
 */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(env),
        PrismaModule,
        AuditModule,
        AuthModule,
        HealthModule,
        UsersModule,
        RolesModule,
        BranchesModule,
      ],
    };
  }
}
