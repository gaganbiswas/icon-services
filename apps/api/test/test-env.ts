import { type Env, parseEnv } from '../src/config/env.js';

/** Env for tests that do not touch real services. */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
    REDIS_URL: 'redis://127.0.0.1:1',
    API_CORS_ORIGINS: 'http://localhost:5173',
    ...overrides,
  });
}
