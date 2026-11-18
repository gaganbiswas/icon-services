import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { HealthIndicator } from './health-indicator.js';

/** Redis readiness probe (Redis backs the BullMQ job queues). */
@Injectable()
export class RedisHealthIndicator implements HealthIndicator, OnModuleDestroy {
  readonly name = 'redis';
  private readonly client: Redis;

  constructor(@Inject(APP_ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    // Connection errors surface through check(); avoid unhandled 'error' events.
    this.client.on('error', () => undefined);
  }

  async check(): Promise<boolean> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
    return (await this.client.ping()) === 'PONG';
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end' && this.client.status !== 'wait') {
      await this.client.quit();
    } else {
      this.client.disconnect();
    }
  }
}
