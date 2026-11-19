import {
  API_BASE_PATH,
  type AccessTokenResponse,
  CSRF_HEADER,
  type ErrorCode,
  type ErrorResponse,
  type MeResponse,
} from '@icon/contracts';

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

type Fetch = typeof fetch;

/**
 * Browser API client for the staff panel (ADR 0010):
 * - access token kept in memory only (never localStorage);
 * - refresh token lives in an HttpOnly cookie the script cannot read;
 * - refresh calls are single-flight, because reusing a rotated refresh token
 *   revokes the whole session.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<AccessTokenResponse | null> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
  ) {}

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  async login(email: string, password: string): Promise<AccessTokenResponse> {
    const result = await this.send<AccessTokenResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    this.accessToken = result.accessToken;
    return result;
  }

  /** Restores a session from the refresh cookie. Resolves null when signed out. */
  refresh(): Promise<AccessTokenResponse | null> {
    this.refreshing ??= this.send<AccessTokenResponse>('/auth/refresh', {
      method: 'POST',
      csrf: true,
    })
      .then((result) => {
        this.accessToken = result.accessToken;
        return result;
      })
      .catch((error: unknown) => {
        this.accessToken = null;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return null;
        }
        throw error;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async logout(): Promise<void> {
    try {
      await this.send<void>('/auth/logout', { method: 'POST', csrf: true });
    } finally {
      this.accessToken = null;
    }
  }

  me(): Promise<MeResponse> {
    return this.authorized<MeResponse>('/me', { method: 'GET' });
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.authorized<void>('/auth/password/change', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  }

  completePasswordSetup(token: string, newPassword: string): Promise<void> {
    return this.send<void>('/auth/password-setup/complete', {
      method: 'POST',
      body: { token, newPassword },
    });
  }

  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.authorized<T>(`${path}${suffix}`, { method: 'GET' });
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.authorized<T>(path, { method: 'POST', body, ...(headers ? { headers } : {}) });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.authorized<T>(path, { method: 'PATCH', body });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.authorized<T>(path, { method: 'PUT', body });
  }

  /** Authenticated file download (report exports); refreshes once on 401. */
  async download(
    path: string,
    query: Record<string, string | undefined>,
  ): Promise<{ blob: Blob; filename: string }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, value);
    }
    const url = `${path}?${params.toString()}`;
    try {
      return await this.sendDownload(url);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !(await this.refresh()))
        throw error;
      return this.sendDownload(url);
    }
  }

  private async sendDownload(path: string): Promise<{ blob: Blob; filename: string }> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${API_BASE_PATH}${path}`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ErrorResponse | null;
      throw new ApiError(
        response.status,
        payload?.error.code ?? 'INTERNAL_ERROR',
        payload?.error.message ?? 'Something went wrong. Please try again.',
        payload?.error.details ?? [],
      );
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export';
    return { blob: await response.blob(), filename };
  }

  /** Multipart upload of a single file in the "file" field. */
  upload<T>(path: string, file: Blob, fileName: string): Promise<T> {
    const form = new FormData();
    form.append('file', file, fileName);
    return this.authorized<T>(path, { method: 'POST', body: form });
  }

  /** Authenticated call; on an expired access token refreshes once and retries. */
  async authorized<T>(
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<T> {
    try {
      return await this.send<T>(path, { ...init, auth: true });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
      const refreshed = await this.refresh();
      if (!refreshed) {
        throw error;
      }
      return this.send<T>(path, { ...init, auth: true });
    }
  }

  private async send<T>(
    path: string,
    init: {
      method: string;
      body?: unknown;
      auth?: boolean;
      csrf?: boolean;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const isForm = init.body instanceof FormData;
    const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
    // Multipart bodies set their own boundary header.
    if (init.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (init.csrf) headers[CSRF_HEADER] = '1';
    if (init.auth && this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${API_BASE_PATH}${path}`, {
        method: init.method,
        headers,
        credentials: 'include',
        ...(init.body !== undefined
          ? { body: isForm ? (init.body as FormData) : JSON.stringify(init.body) }
          : {}),
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
    }
    if (response.status === 204) {
      return undefined as T;
    }
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

const baseUrl =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:4000';

export const apiClient = new ApiClient(baseUrl.replace(/\/$/, ''));
