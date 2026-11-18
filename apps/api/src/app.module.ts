import { type DynamicModule, Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';

/**
 * Root module. Domain modules (CLAUDE.md §3) are added phase by phase.
 */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [AppConfigModule.forRoot(env), HealthModule],
    };
  }
}
