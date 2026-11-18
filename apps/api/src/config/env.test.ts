import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, enabledLogLevels, parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://user:secret-password@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6380',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  S3_BUCKET: 'icon-dev',
  OTP_PEPPER: 'p'.repeat(32),
};

describe('parseEnv', () => {
  it('applies safe defaults', () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      API_CORS_ORIGINS: [],
      API_DOCS_ENABLED: false,
      LOG_LEVEL: 'log',
      LOG_FORMAT: 'json',
    });
  });

  it('parses ports, booleans and comma-separated origins', () => {
    const env = parseEnv({
      ...valid,
      API_PORT: '8080',
      API_DOCS_ENABLED: 'true',
      API_CORS_ORIGINS: ' http://localhost:5173 ,https://admin.example.test,',
    });
    expect(env.API_PORT).toBe(8080);
    expect(env.API_DOCS_ENABLED).toBe(true);
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://admin.example.test']);
  });

  it('rejects missing required variables', () => {
    expect(() => parseEnv({})).toThrow(InvalidEnvironmentError);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects invalid ports and booleans', () => {
    expect(() => parseEnv({ ...valid, API_PORT: '70000' })).toThrow(/API_PORT/);
    expect(() => parseEnv({ ...valid, API_DOCS_ENABLED: 'yes' })).toThrow(/API_DOCS_ENABLED/);
  });

  it('rejects non-http CORS origins', () => {
    expect(() => parseEnv({ ...valid, API_CORS_ORIGINS: 'javascript:alert(1)' })).toThrow(
      /API_CORS_ORIGINS/,
    );
  });

  it('never includes secret values in error messages', () => {
    const secret = 'super-secret-value-123';
    try {
      parseEnv({ ...valid, REDIS_URL: `ftp://user:${secret}@host` });
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEnvironmentError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe('auth settings', () => {
  it('applies secure defaults', () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_IDLE_TTL_DAYS: 7,
      SESSION_ABSOLUTE_TTL_DAYS: 30,
      AUTH_COOKIE_SECURE: true,
      LOGIN_MAX_FAILED_ATTEMPTS: 5,
      AUDIT_STORE_CLIENT_METADATA: false,
      HTTP_TRUST_PROXY: 0,
    });
  });

  it('requires a long JWT secret', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses the mock OTP provider in production', () => {
    expect(() =>
      parseEnv({ ...valid, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'true' }),
    ).toThrow(/OTP_PROVIDER/);
  });

  it('refuses insecure cookies in production', () => {
    expect(() =>
      parseEnv({ ...valid, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' }),
    ).toThrow(/AUTH_COOKIE_SECURE/);
  });

  it('keeps refresh idle lifetime within the session lifetime', () => {
    expect(() =>
      parseEnv({ ...valid, REFRESH_TOKEN_IDLE_TTL_DAYS: '20', SESSION_ABSOLUTE_TTL_DAYS: '10' }),
    ).toThrow(/REFRESH_TOKEN_IDLE_TTL_DAYS/);
  });
});

describe('enabledLogLevels', () => {
  it('returns the configured level and everything more severe', () => {
    expect(enabledLogLevels('warn')).toEqual(['warn', 'error', 'fatal']);
    expect(enabledLogLevels('verbose')).toHaveLength(6);
  });
});
