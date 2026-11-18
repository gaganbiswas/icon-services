import type { MeResponse } from '@icon/contracts';
import { vi } from 'vitest';

import { ApiClient } from '../lib/api-client';

export const ME: MeResponse = {
  id: '01a1eeac-6f23-74c8-bac5-bb6d4e1254e4',
  email: 'admin@example.test',
  fullName: 'Asha Admin',
  organization: { id: '01a1eeac-6f23-74c8-bac5-bb6d4e1254e5', code: 'DEV', displayName: 'Dev Org' },
  roles: [{ id: '01a1eeac-6f23-74c8-bac5-bb6d4e1254e6', code: 'SUPER_ADMIN', name: 'Super Admin' }],
  permissions: ['users.read'],
  branchAccess: 'ALL',
  mustChangePassword: false,
};

export type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };

export function json(status: number, body?: unknown) {
  return { status, body };
}

/** ApiClient backed by a scripted fetch; records every call. */
export function fakeClient(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init: init ?? {} };
    calls.push(call);
    const { status, body } = handler(url, call.init);
    await Promise.resolve();
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { client: new ApiClient('http://api.test', fetchImpl), calls };
}
