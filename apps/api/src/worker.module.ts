import { type DynamicModule, Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { NotificationDeliveryModule } from './notifications/notifications.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/** Background worker: no HTTP server, only queue/outbox processing. */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [AppConfigModule.forRoot(env), PrismaModule, NotificationDeliveryModule],
    };
  }
}
