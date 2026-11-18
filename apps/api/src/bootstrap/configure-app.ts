import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_BASE_PATH } from '@icon/contracts';
import helmet from 'helmet';

import type { Env } from '../config/env.js';

/** Path (without leading slash) where OpenAPI docs are served when enabled. */
export const API_DOCS_PATH = 'api/docs';

/**
 * Applies HTTP-level configuration shared by the running server and tests,
 * so tests exercise the same security headers, CORS and routing.
 */
export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
  app.use(helmet());
  app.enableCors({
    // Explicit allow-list only; an empty list disables cross-origin access.
    origin: env.API_CORS_ORIGINS,
    credentials: true,
  });

  if (env.API_DOCS_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('ICON INFOSYS SERVICE MANAGEMENT API')
      .setVersion('v1')
      .build();
    SwaggerModule.setup(API_DOCS_PATH, app, () => SwaggerModule.createDocument(app, config));
  }
}
