import { describe, expect, it } from 'vitest';

import { ME, fakeClient, json } from '../test/fake-api';
import { ApiError } from './api-client';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};

describe('ApiClient', () => {
  it('sends credentials, CSRF header on refresh, and bearer token on authorized calls', async () => {
    const { client, calls } = fakeClient((url) => {
      if (url.endsWith('/auth/refresh')) return json(200, TOKEN);
      return json(200, ME);
    });
    await client.refresh();
    await client.me();
    const [refresh, me] = calls;
    expect(refresh?.url).toBe('http://api.test/api/v1/auth/refresh');
    expect(refresh?.init.credentials).toBe('include');
    expect((refresh?.init.headers as Record<string, string>)['x-icon-csrf']).toBe('1');
    expect((me?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.b.c');
  });

  it('refreshes only once for concurrent callers (single-flight)', async () => {
    const { client, calls } = fakeClient(() => json(200, TOKEN));
    await Promise.all([client.refresh(), client.refresh(), client.refresh()]);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('retries an authorized call once after refreshing an expired access token', async () => {
    let meCalls = 0;
    const { client, calls } = fakeClient((url) => {
      if (url.endsWith('/auth/refresh')) return json(200, TOKEN);
      meCalls += 1;
      return meCalls === 1
        ? json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })
        : json(200, ME);
    });
    await expect(client.me()).resolves.toEqual(ME);
    expect(calls.map((c) => c.url.split('/api/v1')[1])).toEqual(['/me', '/auth/refresh', '/me']);
  });

  it('returns null from refresh when signed out', async () => {
    const { client } = fakeClient(() =>
      json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }),
    );
    await expect(client.refresh()).resolves.toBeNull();
    expect(client.isAuthenticated).toBe(false);
  });

  it('surfaces API errors with code and field details', async () => {
    const { client } = fakeClient(() =>
      json(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request is invalid',
          details: [{ path: 'email', message: 'Invalid' }],
        },
      }),
    );
    const error = await client.login('x', 'y').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: [{ path: 'email', message: 'Invalid' }],
    });
  });

  it('maps network failures to a friendly error', async () => {
    const { ApiClient: Client } = await import('./api-client');
    const client = new Client('http://api.test', () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    await expect(client.me()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
