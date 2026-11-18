import { Module } from '@nestjs/common';

import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';
import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator.js';
import { HealthService } from './health.service.js';
import { RedisHealthIndicator } from './redis.health.js';
import { StorageHealthIndicator } from './storage.health.js';

@Module({
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    StorageHealthIndicator,
    {
      provide: HEALTH_INDICATORS,
      useFactory: (
        database: DatabaseHealthIndicator,
        redis: RedisHealthIndicator,
        storage: StorageHealthIndicator,
      ) => [database, redis, storage] satisfies HealthIndicator[],
      inject: [DatabaseHealthIndicator, RedisHealthIndicator, StorageHealthIndicator],
    },
    HealthService,
  ],
})
export class HealthModule {}
