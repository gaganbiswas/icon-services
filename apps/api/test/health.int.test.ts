import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestApp, createTestApp } from './integration/harness.js';

/** Readiness against real PostgreSQL and Redis. */
describe('Health readiness (real services)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports PostgreSQL and Redis as up', async () => {
    const response = await request(t.server()).get('/api/v1/health/ready');
    expect(response.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    expect(response.status).toBe(200);
  });
});
