import { type DynamicModule, Module } from '@nestjs/common';

import { AssetsModule } from './assets/assets.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { AppConfigModule } from './config/config.module.js';
import { CustomerAuthModule } from './customer-auth/customer-auth.module.js';
import { CustomerPortalModule } from './customer-portal/customer-portal.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { FilesModule } from './files/files.module.js';
import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { EstimatesModule } from './estimates/estimates.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RolesModule } from './roles/roles.module.js';
import { SettingsModule } from './settings/settings.module.js';
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
        SettingsModule,
        FilesModule,
        DocumentsModule,
        AuthModule,
        CustomerAuthModule,
        HealthModule,
        UsersModule,
        RolesModule,
        BranchesModule,
        CustomersModule,
        AssetsModule,
        JobsModule,
        EstimatesModule,
        InventoryModule,
        NotificationsModule,
        CustomerPortalModule,
      ],
    };
  }
}
