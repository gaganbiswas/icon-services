import { ConsoleLogger } from '@nestjs/common';

import { type Env, enabledLogLevels } from '../config/env.js';

/** Structured JSON logs in production; human-readable logs locally. */
export function createLogger(env: Pick<Env, 'LOG_FORMAT' | 'LOG_LEVEL'>): ConsoleLogger {
  return new ConsoleLogger({
    prefix: 'icon-api',
    json: env.LOG_FORMAT === 'json',
    colors: env.LOG_FORMAT === 'pretty',
    logLevels: enabledLogLevels(env.LOG_LEVEL),
  });
}
