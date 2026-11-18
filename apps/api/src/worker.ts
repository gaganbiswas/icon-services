import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { createLogger } from './bootstrap/create-logger.js';
import { loadLocalEnvFile } from './bootstrap/load-local-env-file.js';
import { parseEnv } from './config/env.js';
import { NotificationDispatcher } from './notifications/notification-dispatcher.service.js';
import { WorkerModule } from './worker.module.js';

/**
 * Background worker entry point: delivers outbox notifications. Run alongside
 * the API (`bun run start:worker`); several instances may run safely.
 */
async function main(): Promise<void> {
  loadLocalEnvFile();
  const env = parseEnv(process.env);
  const logger = createLogger(env);
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), { logger });
  app.enableShutdownHooks();
  const dispatcher = app.get(NotificationDispatcher);
  const log = new Logger('Worker');

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  log.log(`Notification worker started (poll every ${env.NOTIFICATION_POLL_INTERVAL_MS} ms)`);
  while (!stopping) {
    try {
      const handled = await dispatcher.dispatchDue();
      if (handled > 0) log.log(`Processed ${handled} notification(s)`);
    } catch (error) {
      log.error(`Dispatch cycle failed: ${error instanceof Error ? error.name : 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, env.NOTIFICATION_POLL_INTERVAL_MS));
  }
  await app.close();
  log.log('Worker stopped');
}

main().catch((error: unknown) => {
  new Logger('Worker').fatal(error instanceof Error ? error.message : 'Worker start-up failed');
  process.exit(1);
});
