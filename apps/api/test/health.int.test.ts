import 'reflect-metadata';

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { loadLocalEnvFile } from '../src/bootstrap/load-local-env-file.js';
import { parseEnv } from '../src/config/env.js';

/**
 * Integration test against real PostgreSQL and Redis
 * (Docker Compose locally, service containers in CI).
 */
describe('Health readiness (real services)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    loadLocalEnvFile();
    const env = parseEnv({ ...process.env, NODE_ENV: 'test' });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports PostgreSQL and Redis as up', async () => {
    const response = await request(app.getHttpServer() as Server).get('/api/v1/health/ready');
    expect(response.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    expect(response.status).toBe(200);
  });
});
