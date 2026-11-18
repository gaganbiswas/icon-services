import { Injectable } from '@nestjs/common';

import { StorageService } from '../files/storage.service.js';
import type { HealthIndicator } from './health-indicator.js';

/** Object storage readiness: the configured bucket is reachable with our credentials. */
@Injectable()
export class StorageHealthIndicator implements HealthIndicator {
  readonly name = 'storage';

  constructor(private readonly storage: StorageService) {}

  check(): Promise<boolean> {
    return this.storage.isReachable();
  }
}
