import { API_BASE_PATH, type CustomerEstimate, type ErrorResponse } from '@icon/contracts';

const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class PortalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PortalError';
  }
}

async function post<T>(path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${BASE}${API_BASE_PATH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new PortalError(
      'NETWORK_ERROR',
      'Cannot reach the service centre. Check your connection and try again.',
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as ErrorResponse | null)?.error;
    throw new PortalError(
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
    );
  }
  return payload as T;
}

export const portalApi = {
  viewEstimate: (token: string, fetchImpl?: typeof fetch) =>
    post<CustomerEstimate>('/public/estimate-links/view', { token }, fetchImpl),
  decide: (
    token: string,
    decision: { decision: 'APPROVED' | 'REJECTED'; termsAccepted: boolean; comment?: string },
    fetchImpl?: typeof fetch,
  ) => post<CustomerEstimate>('/public/estimate-links/decision', { token, ...decision }, fetchImpl),
};

/** Token from the URL fragment (#token=…); fragments are never sent to servers. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && /^[A-Za-z0-9_-]{32,100}$/.test(token) ? token : null;
}
