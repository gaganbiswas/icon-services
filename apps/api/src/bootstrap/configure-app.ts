import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_BASE_PATH, CSRF_HEADER } from '@icon/contracts';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppExceptionFilter } from '../common/app-exception.filter.js';
import { requestContextMiddleware } from '../common/request-context.js';
import type { Env } from '../config/env.js';

/** Path (without leading slash) where OpenAPI docs are served when enabled. */
export const API_DOCS_PATH = 'api/docs';

/**
 * Applies HTTP-level configuration shared by the running server and tests,
 * so tests exercise the same security headers, CORS, cookies and routing.
 */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  // Client IP from X-Forwarded-For only for the configured number of proxies.
  express.set('trust proxy', env.HTTP_TRUST_PROXY);
  express.disable('x-powered-by');

  app.use(requestContextMiddleware);
  app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    // Explicit allow-list only; an empty list disables cross-origin access.
    origin: env.API_CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['authorization', 'content-type', 'x-request-id', CSRF_HEADER],
    exposedHeaders: ['x-request-id'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    maxAge: 600,
  });
  app.useGlobalFilters(new AppExceptionFilter());

  if (env.API_DOCS_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('ICON INFOSYS SERVICE MANAGEMENT API')
      .setVersion('v1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(API_DOCS_PATH, app, () => SwaggerModule.createDocument(app, config));
  }
}
