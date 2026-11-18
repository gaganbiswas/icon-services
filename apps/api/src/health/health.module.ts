import { Module } from '@nestjs/common';

import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';
import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator.js';
import { HealthService } from './health.service.js';
import { RedisHealthIndicator } from './redis.health.js';

@Module({
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    {
      provide: HEALTH_INDICATORS,
      useFactory: (database: DatabaseHealthIndicator, redis: RedisHealthIndicator) =>
        [database, redis] satisfies HealthIndicator[],
      inject: [DatabaseHealthIndicator, RedisHealthIndicator],
    },
    HealthService,
  ],
})
export class HealthModule {}
