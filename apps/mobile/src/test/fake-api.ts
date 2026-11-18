import { CustomerApi } from '../api/client';
import { memoryTokenStore } from '../api/token-store';

export type Handler = (path: string, init: RequestInit) => { status: number; body?: unknown };

export const json = (status: number, body?: unknown) => ({ status, body });

/** CustomerApi backed by a scripted fetch and in-memory token store. */
export function fakeApi(handler: Handler, refreshToken: string | null = null) {
  const calls: { path: string; init: RequestInit }[] = [];
  const store = memoryTokenStore(refreshToken);
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('/api/v1')[1] ?? url;
    const call = { path, init: init ?? {} };
    calls.push(call);
    const { status, body } = handler(path, call.init);
    await Promise.resolve();
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { api: new CustomerApi('http://api.test', 'DEV', store, fetchImpl), calls, store };
}

export const TOKENS = {
  accessToken: 'a.b.c',
  refreshToken: 'refresh-token-value-0123456789',
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshExpiresAt: '2027-01-01T00:00:00.000Z',
};
