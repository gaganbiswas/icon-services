import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { createLogger } from './bootstrap/create-logger.js';
import { loadLocalEnvFile } from './bootstrap/load-local-env-file.js';
import { parseEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  loadLocalEnvFile();
  const env = parseEnv(process.env);
  const logger = createLogger(env);

  const app = await NestFactory.create(AppModule.forRoot(env), { logger });
  configureApp(app, env);
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  logger.log(`API listening on port ${env.API_PORT} (${env.NODE_ENV})`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Configuration errors list variable names only, never values.
  new Logger('Bootstrap').fatal(error instanceof Error ? error.message : 'Start-up failed');
  process.exit(1);
});
