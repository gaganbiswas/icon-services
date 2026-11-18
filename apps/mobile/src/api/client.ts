import {
  API_BASE_PATH,
  type Asset,
  type AssetCategory,
  type CustomerComplaintRequest,
  type CustomerEstimate,
  type CustomerPayment,
  type CustomerJob,
  type CustomerProfile,
  type CustomerTokenResponse,
  type DocumentLink,
  type ErrorCode,
  type ErrorResponse,
  type StoredFileInfo,
} from '@icon/contracts';

import type { TokenStore } from './token-store';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UploadablePhoto {
  readonly uri: string;
  readonly name: string;
  readonly type: string;
}

type Fetch = typeof fetch;

/**
 * Customer API client. Access token in memory only; refresh token in the OS
 * secure store. Refresh is single-flight because a reused refresh token
 * revokes the session (ADR 0012).
 */
export class CustomerApi {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly baseUrl: string,
    readonly organizationCode: string,
    private readonly store: TokenStore,
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
  ) {}

  requestCode(phone: string): Promise<{ sent: true; expiresInSeconds: number }> {
    return this.send('/customer/auth/otp/request', {
      method: 'POST',
      body: { organizationCode: this.organizationCode, phone },
    });
  }

  async verifyCode(phone: string, code: string, fullName?: string): Promise<void> {
    const tokens = await this.send<CustomerTokenResponse>('/customer/auth/otp/verify', {
      method: 'POST',
      body: {
        organizationCode: this.organizationCode,
        phone,
        code,
        ...(fullName ? { fullName } : {}),
      },
    });
    await this.accept(tokens);
  }

  /** Restores a session from the stored refresh token. */
  restore(): Promise<boolean> {
    this.refreshing ??= (async () => {
      const refreshToken = await this.store.get();
      if (!refreshToken) return false;
      try {
        await this.accept(
          await this.send<CustomerTokenResponse>('/customer/auth/refresh', {
            method: 'POST',
            body: { refreshToken },
          }),
        );
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await this.store.clear();
          this.accessToken = null;
          return false;
        }
        throw error;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async signOut(): Promise<void> {
    const refreshToken = await this.store.get();
    this.accessToken = null;
    await this.store.clear();
    if (refreshToken) {
      await this.send<void>('/customer/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      }).catch(() => undefined);
    }
  }

  me = () => this.authorized<CustomerProfile>('/customer/me', { method: 'GET' });
  branches = () =>
    this.authorized<{ id: string; name: string }[]>('/customer/branches', { method: 'GET' });
  categories = () =>
    this.authorized<AssetCategory[]>('/customer/asset-categories', { method: 'GET' });
  devices = () => this.authorized<Asset[]>('/customer/assets', { method: 'GET' });
  jobs = () => this.authorized<CustomerJob[]>('/customer/jobs', { method: 'GET' });
  job = (id: string) =>
    this.authorized<CustomerJob>(`/customer/jobs/${encodeURIComponent(id)}`, { method: 'GET' });
  estimates = (jobId: string) =>
    this.authorized<CustomerEstimate[]>(`/customer/jobs/${encodeURIComponent(jobId)}/estimates`, {
      method: 'GET',
    });
  decideEstimate = (
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    termsAccepted: boolean,
    comment?: string,
  ) =>
    this.authorized<CustomerEstimate>(`/customer/estimates/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: { decision, termsAccepted, ...(comment ? { comment } : {}) },
    });
  payments = () => this.authorized<CustomerPayment[]>('/customer/payments', { method: 'GET' });
  paymentReceipt = (id: string) =>
    this.authorized<DocumentLink>(`/customer/payments/${encodeURIComponent(id)}/receipt`, {
      method: 'POST',
    });
  receipt = (id: string) =>
    this.authorized<DocumentLink>(`/customer/jobs/${encodeURIComponent(id)}/receipt`, {
      method: 'POST',
    });

  submitComplaint(body: CustomerComplaintRequest, idempotencyKey: string): Promise<CustomerJob> {
    return this.authorized('/customer/jobs', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  uploadPhoto(photo: UploadablePhoto): Promise<StoredFileInfo> {
    const form = new FormData();
    // React Native's FormData accepts { uri, name, type } file descriptors.
    form.append('file', photo as unknown as Blob);
    return this.authorized('/customer/files', { method: 'POST', body: form });
  }

  private async accept(tokens: CustomerTokenResponse): Promise<void> {
    this.accessToken = tokens.accessToken;
    await this.store.set(tokens.refreshToken);
  }

  private async authorized<T>(
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<T> {
    if (!this.accessToken) await this.restore();
    try {
      return await this.send<T>(path, { ...init, auth: true });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!(await this.restore())) throw error;
      return this.send<T>(path, { ...init, auth: true });
    }
  }

  private async send<T>(
    path: string,
    init: { method: string; body?: unknown; auth?: boolean; headers?: Record<string, string> },
  ): Promise<T> {
    const isForm = init.body instanceof FormData;
    const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
    if (init.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (init.auth && this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${API_BASE_PATH}${path}`, {
        method: init.method,
        headers,
        ...(init.body !== undefined
          ? { body: isForm ? (init.body as FormData) : JSON.stringify(init.body) }
          : {}),
      });
    } catch {
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        'Cannot reach the service centre. Check your internet connection.',
      );
    }
    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (payload as ErrorResponse | null)?.error;
      throw new ApiError(
        response.status,
        error?.code ?? 'INTERNAL_ERROR',
        error?.message ?? 'Something went wrong. Please try again.',
        error?.details ?? [],
      );
    }
    return payload as T;
  }
}

/** Unique key for one intended submission (reused when retrying). */
export function newIdempotencyKey(): string {
  const random = () => Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}-${random()}${random()}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}
