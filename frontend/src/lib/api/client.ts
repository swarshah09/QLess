import { API_BASE_URL } from './config';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
  type Tokens,
} from './tokens';

// Single HTTP gateway to the backend. Services call this; components never do.

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

/** Carries the backend's stable `error.code` so callers can branch on it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the user must re-authenticate. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: ApiErrorDetail[] };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Attach the bearer token. Default true; discovery endpoints work without. */
  auth?: boolean;
  signal?: AbortSignal;
  /** Internal: prevents a refresh loop. */
  _retried?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Listeners notified when the session ends irrecoverably. */
const authFailureListeners = new Set<() => void>();

export function onAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

function notifyAuthFailure(): void {
  clearTokens();
  authFailureListeners.forEach((listener) => listener());
}

/**
 * Refresh is de-duplicated: several requests failing with 401 at once must
 * trigger exactly one refresh, because the backend rotates the token and
 * treats a replayed one as a leak (revoking every session).
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) return false;

      const payload = (await response.json()) as Envelope<{ tokens: Tokens }>;
      if (!payload.success || !payload.data?.tokens) return false;

      setTokens(payload.data.tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }

  if (response.status === 204) return undefined as T;

  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError(response.status, 'INTERNAL_ERROR', 'Unexpected server response');
  }

  if (response.ok && payload.success) {
    return payload.data as T;
  }

  const code = payload.error?.code ?? 'INTERNAL_ERROR';
  const message = payload.error?.message ?? 'Request failed';

  // One refresh-and-retry per request, and only when a refresh token exists.
  if (response.status === 401 && auth && !options._retried && getRefreshToken()) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
    notifyAuthFailure();
  }

  throw new ApiError(response.status, code, message, payload.error?.details ?? []);
}

/** Reads `meta` alongside `data` — used where pagination info is needed. */
export async function apiRequestWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const { method = 'GET', body, query, auth = true, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const payload = (await response.json()) as Envelope<T>;

  if (!response.ok || !payload.success) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'INTERNAL_ERROR',
      payload.error?.message ?? 'Request failed',
      payload.error?.details ?? [],
    );
  }

  return { data: payload.data as T, meta: payload.meta ?? {} };
}
