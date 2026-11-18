import 'reflect-metadata';

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LivenessResponseSchema, ReadinessResponseSchema } from '@icon/contracts';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { DatabaseHealthIndicator } from '../src/health/database.health.js';
import { RedisHealthIndicator } from '../src/health/redis.health.js';
import { StorageHealthIndicator } from '../src/health/storage.health.js';
import { testEnv } from './test-env.js';

/** Controllable stand-in for a real dependency check. */
class FakeIndicator {
  healthy = true;
  constructor(readonly name: string) {}
  check(): Promise<boolean> {
    return Promise.resolve(this.healthy);
  }
}

describe('Health endpoints (HTTP, mocked dependencies)', () => {
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;
  const database = new FakeIndicator('database');
  const redis = new FakeIndicator('redis');
  const storage = new FakeIndicator('storage');

  beforeAll(async () => {
    const env = testEnv({ API_DOCS_ENABLED: 'true' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(DatabaseHealthIndicator)
      .useValue(database)
      .overrideProvider(RedisHealthIndicator)
      .useValue(redis)
      .overrideProvider(StorageHealthIndicator)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
  });

  afterEach(() => {
    database.healthy = true;
    redis.healthy = true;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live returns ok', async () => {
    const response = await request(server()).get('/api/v1/health/live').expect(200);
    expect(LivenessResponseSchema.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready returns 200 when dependencies are up', async () => {
    const response = await request(server()).get('/api/v1/health/ready').expect(200);
    expect(ReadinessResponseSchema.parse(response.body)).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up', storage: 'up' },
    });
  });

  it('GET /api/v1/health/ready returns 503 when a dependency is down', async () => {
    redis.healthy = false;
    const response = await request(server()).get('/api/v1/health/ready').expect(503);
    expect(response.body).toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down', storage: 'up' },
    });
  });

  it('sends security headers and hides the framework', async () => {
    const response = await request(server()).get('/api/v1/health/live');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await request(server())
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(server())
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the OpenAPI document generated from the controllers', async () => {
    const response = await request(server()).get('/api/docs-json').expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/health/live', '/api/v1/health/ready']),
    );
  });

  it('returns 404 for unversioned routes', async () => {
    await request(server()).get('/health/live').expect(404);
  });
});
