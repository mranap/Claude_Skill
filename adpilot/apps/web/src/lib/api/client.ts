import { ApiError, errorFromResponse } from './errors';

/**
 * Browser API client.
 *
 *  - Same-origin requests to `/api/*` with `credentials: 'include'` (HttpOnly auth cookies set by the API).
 *  - CSRF: every POST/PUT/PATCH/DELETE carries `X-CSRF-Token`, read from the readable CSRF cookie right
 *    before sending (the server rotates it on login/refresh/logout). If the cookie is missing, the token is
 *    fetched from `GET /api/auth/csrf`; a `CSRF_INVALID` answer triggers one re-fetch + retry.
 *  - Sessions: a 401 UNAUTHORIZED/SESSION_EXPIRED triggers a single-flight `POST /api/auth/refresh` shared
 *    by all concurrent requests, then the original request is retried once. If the refresh is rejected the
 *    client emits `unauthenticated` (the AuthProvider clears state and redirects to /login?next=…).
 */

const API_BASE = '/api';
const CSRF_COOKIES = ['__Host-ap_csrf', 'ap_csrf'];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Endpoints that must never trigger the refresh-and-retry logic. */
const NO_REFRESH = [/^\/auth\/(login|refresh|logout|csrf)/, /^\/auth\/password\//, /^\/auth\/email\/confirm/];

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /**
   * `false` disables the refresh-on-401 logic and the global `unauthenticated` event (used by pages that
   * only probe whether a session exists, e.g. the login page).
   */
  auth?: boolean;
}

// ───────────────────────────── Events ─────────────────────────────

export type ApiEvent =
  | { type: 'unauthenticated' }
  | { type: 'password-change-required' }
  | { type: 'maintenance'; message: string };

const listeners = new Set<(event: ApiEvent) => void>();

export function onApiEvent(listener: (event: ApiEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Signals that the session is gone (used by transports outside `apiRequest`, e.g. XHR uploads). */
export function notifyUnauthenticated(): void {
  emit({ type: 'unauthenticated' });
}

function emit(event: ApiEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error(err);
    }
  }
}

// ───────────────────────────── CSRF ─────────────────────────────

export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const name of CSRF_COOKIES) {
    const hit = cookies.find((c) => c.startsWith(`${name}=`));
    if (hit) {
      const value = hit.slice(name.length + 1);
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

let csrfRequest: Promise<string | null> | null = null;
let csrfPending = false;

/**
 * Calls `GET /api/auth/csrf`, which (re)issues the CSRF cookie. Callers arriving while a request is in
 * flight share it; `force` starts a new request once the previous one has settled.
 */
export function fetchCsrfToken(force = false): Promise<string | null> {
  if (!csrfRequest || (force && !csrfPending)) {
    csrfPending = true;
    csrfRequest = fetch(`${API_BASE}/auth/csrf`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (res) =>
        res.ok ? (((await res.json()) as { csrfToken?: string }).csrfToken ?? null) : null,
      )
      .catch(() => null)
      .then((token) => readCsrfCookie() ?? token)
      .finally(() => {
        csrfPending = false;
      });
  }
  return csrfRequest;
}

/** The cookie is the source of truth; without it any cached token is stale, so a fresh one is issued. */
export async function ensureCsrfToken(): Promise<string | null> {
  return readCsrfCookie() ?? (await fetchCsrfToken(true));
}

// ───────────────────────────── Refresh ─────────────────────────────

type RefreshResult = 'ok' | 'expired' | 'error';
let refreshInFlight: Promise<RefreshResult> | null = null;
let lastRefreshAt = 0;

/** Rotates the refresh token. All callers that arrive while a refresh is running share its result. */
export function refreshSession(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<RefreshResult> => {
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        const token = readCsrfCookie();
        if (token) headers['X-CSRF-Token'] = token;
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers,
        });
        if (res.ok) {
          lastRefreshAt = Date.now();
          return 'ok';
        }
        return res.status === 401 || res.status === 403 ? 'expired' : 'error';
      } catch {
        return 'error';
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ───────────────────────────── Requests ─────────────────────────────

export function buildUrl(path: string, query?: QueryParams): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function networkError(): ApiError {
  return new ApiError({
    status: 0,
    code: 'NETWORK_ERROR',
    message: 'Cannot reach the server. Check your connection and try again.',
  });
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers = new Headers(opts.headers);
  headers.set('Accept', 'application/json');
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData || opts.body instanceof Blob) {
      body = opts.body;
    } else {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(opts.body);
    }
  }
  if (MUTATING.has(method)) {
    const token = await ensureCsrfToken();
    if (token) headers.set('X-CSRF-Token', token);
  }
  try {
    return await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body,
      credentials: 'include',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw networkError();
  }
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const startedAt = Date.now();
  const canRefresh = opts.auth !== false && !NO_REFRESH.some((re) => re.test(path));

  let res = await send(path, opts);

  if (res.status === 401 && canRefresh) {
    const error = await errorFromResponse(res);
    if (!error.is('UNAUTHORIZED', 'SESSION_EXPIRED')) throw error;
    // Another request may already have refreshed the session after this one was sent.
    const refreshed = lastRefreshAt > startedAt ? 'ok' : await refreshSession();
    if (refreshed === 'error') throw networkError();
    if (refreshed === 'expired') {
      emit({ type: 'unauthenticated' });
      throw error;
    }
    res = await send(path, opts);
    if (res.status === 401) {
      const retryError = await errorFromResponse(res);
      emit({ type: 'unauthenticated' });
      throw retryError;
    }
  }

  if (res.status === 403 && MUTATING.has(method)) {
    const error = await errorFromResponse(res);
    if (!error.is('CSRF_INVALID')) return handleError(error, opts);
    await fetchCsrfToken(true);
    res = await send(path, opts);
  }

  if (!res.ok) return handleError(await errorFromResponse(res), opts);
  return parseBody<T>(res);
}

function handleError(error: ApiError, opts: RequestOptions): never {
  if (opts.auth !== false) {
    if (error.is('PASSWORD_CHANGE_REQUIRED')) emit({ type: 'password-change-required' });
    if (error.is('MAINTENANCE')) emit({ type: 'maintenance', message: error.message });
  }
  throw error;
}

type BodyOptions = Omit<RequestOptions, 'method' | 'body'>;
type GetOptions = Omit<RequestOptions, 'method' | 'body' | 'query'>;

export const api = {
  get: <T>(path: string, query?: QueryParams, opts?: GetOptions) => apiRequest<T>(path, { ...opts, query }),
  post: <T>(path: string, body?: unknown, opts?: BodyOptions) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: BodyOptions) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: BodyOptions) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: BodyOptions) => apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};
