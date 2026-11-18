import { TOKENS, fakeApi, json } from '../test/fake-api';
import { newIdempotencyKey } from './client';

describe('CustomerApi', () => {
  it('stores the refresh token securely and sends the access token', async () => {
    const { api, calls, store } = fakeApi((path) =>
      path.endsWith('/verify') ? json(200, TOKENS) : json(200, []),
    );
    await api.verifyCode('+919812345678', '123456');
    expect(store.value).toBe(TOKENS.refreshToken);
    await api.jobs();
    const jobsCall = calls.find((c) => c.path === '/customer/jobs');
    expect((jobsCall?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer a.b.c',
    );
  });

  it('restores a session with a single refresh for concurrent callers', async () => {
    const { api, calls } = fakeApi(
      (path) =>
        path === '/customer/auth/refresh'
          ? json(200, { ...TOKENS, refreshToken: 'rotated-refresh-token-0001' })
          : json(200, []),
      'stored-refresh-token-000000',
    );
    await Promise.all([api.jobs(), api.devices(), api.branches()]);
    expect(calls.filter((c) => c.path === '/customer/auth/refresh')).toHaveLength(1);
  });

  it('clears a revoked refresh token', async () => {
    const { api, store } = fakeApi(
      () => json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }),
      'old-refresh-token-0000000',
    );
    await expect(api.restore()).resolves.toBe(false);
    expect(store.value).toBeNull();
  });

  it('signs out locally even if the server is unreachable', async () => {
    const { api, store } = fakeApi(() => json(500, {}), 'old-refresh-token-0000000');
    await api.signOut();
    expect(store.value).toBeNull();
  });

  it('generates idempotency keys accepted by the API', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});
