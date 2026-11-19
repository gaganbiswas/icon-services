import {
  API_BASE_PATH,
  type Asset,
  type AssetCategory,
  CSRF_HEADER,
  type CustomerComplaintRequest,
  type CustomerEstimate,
  type CustomerInvoice,
  type CustomerJob,
  type CustomerPayment,
  type CustomerProfile,
  type CustomerWebTokenResponse,
  type DocumentLink,
  type ErrorResponse,
} from '@icon/contracts';

import { PortalError } from './api';

const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const ORGANIZATION_CODE = process.env.NEXT_PUBLIC_ORGANIZATION_CODE ?? 'DEV';

/**
 * Customer portal session (ADR 0012, CLAUDE.md §8): the refresh token lives
 * only in an HttpOnly, SameSite=Strict cookie set by the API; the short-lived
 * access token is kept in memory and never written to storage.
 */
export class CustomerClient {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly base = BASE,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async send<T>(
    path: string,
    init: { method: string; body?: unknown; auth?: boolean; csrf?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.csrf) headers[CSRF_HEADER] = '1';
    if (init.auth && this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${API_BASE_PATH}${path}`, {
        method: init.method,
        headers,
        credentials: 'include',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new PortalError(
        'NETWORK_ERROR',
        'Cannot reach the service centre. Check your connection and try again.',
      );
    }
    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (payload as ErrorResponse | null)?.error;
      throw new PortalError(
        error?.code ?? (response.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR'),
        error?.message ?? 'Something went wrong. Please try again.',
      );
    }
    return payload as T;
  }

  get signedIn(): boolean {
    return this.accessToken !== null;
  }

  requestCode(phone: string): Promise<unknown> {
    return this.send('/customer/auth/otp/request', {
      method: 'POST',
      body: { organizationCode: ORGANIZATION_CODE, phone },
    });
  }

  async verify(phone: string, code: string, fullName?: string): Promise<void> {
    const tokens = await this.send<CustomerWebTokenResponse>('/customer/auth/web/verify', {
      method: 'POST',
      body: { organizationCode: ORGANIZATION_CODE, phone, code, ...(fullName ? { fullName } : {}) },
    });
    this.accessToken = tokens.accessToken;
  }

  /** Restores the session from the cookie; false when signed out. */
  restore(): Promise<boolean> {
    this.refreshing ??= this.send<CustomerWebTokenResponse>('/customer/auth/web/refresh', {
      method: 'POST',
      csrf: true,
    })
      .then((t) => {
        this.accessToken = t.accessToken;
        return true;
      })
      .catch(() => {
        this.accessToken = null;
        return false;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async signOut(): Promise<void> {
    try {
      await this.send('/customer/auth/web/logout', { method: 'POST', csrf: true });
    } finally {
      this.accessToken = null;
    }
  }

  private async authorized<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    try {
      return await this.send<T>(path, { method, body, auth: true });
    } catch (error) {
      if (
        !(error instanceof PortalError) ||
        (error.code !== 'UNAUTHENTICATED' && error.code !== 'INVALID_TOKEN') ||
        !(await this.restore())
      )
        throw error;
      return this.send<T>(path, { method, body, auth: true });
    }
  }

  me = () => this.authorized<CustomerProfile>('/customer/me');
  jobs = () => this.authorized<CustomerJob[]>('/customer/jobs');
  job = (id: string) => this.authorized<CustomerJob>(`/customer/jobs/${encodeURIComponent(id)}`);
  estimates = (jobId: string) =>
    this.authorized<CustomerEstimate[]>(`/customer/jobs/${encodeURIComponent(jobId)}/estimates`);
  decide = (
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    termsAccepted: boolean,
    comment?: string,
  ) =>
    this.authorized<CustomerEstimate>(
      `/customer/estimates/${encodeURIComponent(id)}/decision`,
      'POST',
      { decision, termsAccepted, ...(comment ? { comment } : {}) },
    );
  payments = () => this.authorized<CustomerPayment[]>('/customer/payments');
  invoices = () => this.authorized<CustomerInvoice[]>('/customer/invoices');
  branches = () => this.authorized<{ id: string; name: string }[]>('/customer/branches');
  categories = () => this.authorized<AssetCategory[]>('/customer/asset-categories');
  devices = () => this.authorized<Asset[]>('/customer/assets');
  submit = (request: CustomerComplaintRequest) =>
    this.authorized<CustomerJob>('/customer/jobs', 'POST', request);
  jobReceipt = (id: string) =>
    this.authorized<DocumentLink>(`/customer/jobs/${encodeURIComponent(id)}/receipt`, 'POST');
  paymentReceipt = (id: string) =>
    this.authorized<DocumentLink>(`/customer/payments/${encodeURIComponent(id)}/receipt`, 'POST');
  invoicePdf = (id: string) =>
    this.authorized<DocumentLink>(`/customer/invoices/${encodeURIComponent(id)}/pdf`, 'POST');
  creditNotePdf = (id: string) =>
    this.authorized<DocumentLink>(`/customer/credit-notes/${encodeURIComponent(id)}/pdf`, 'POST');
}
