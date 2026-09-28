import { buildUrl, ensureCsrfToken, fetchCsrfToken, notifyUnauthenticated, refreshSession } from './client';
import { ApiError, errorFromBody } from './errors';

/**
 * Multipart uploads with progress events. `fetch` cannot report upload progress, so uploads use
 * XMLHttpRequest with the same rules as the JSON client: same-origin `/api`, cookies included,
 * `X-CSRF-Token` read from the CSRF cookie, one retry after `CSRF_INVALID`, and a session refresh when the
 * access token expired.
 */

export interface UploadHandlers {
  /** Bytes of the request body sent so far. */
  onProgress?: (loaded: number, total: number) => void;
  /** Every byte was sent; the server is now processing the upload. */
  onSent?: () => void;
  signal?: AbortSignal;
}

type Attempt<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function networkError(): ApiError {
  return new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'The upload was interrupted. Check your connection and try again.' });
}

function abortError(): DOMException {
  return new DOMException('The upload was cancelled', 'AbortError');
}

let sessionCheckedAt = 0;

/**
 * Uploads are large, so an expired access token is detected *before* the body is sent: the public
 * `GET /api/auth/session` endpoint answers without 401 and tells whether a refresh is possible.
 */
async function ensureSession(): Promise<void> {
  if (Date.now() - sessionCheckedAt < 60_000) return;
  let state: { authenticated?: boolean; refreshable?: boolean } | null = null;
  try {
    const res = await fetch(buildUrl('/auth/session'), { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (res.ok) state = (await res.json()) as { authenticated?: boolean; refreshable?: boolean };
  } catch {
    throw networkError();
  }
  if (!state || state.authenticated) {
    sessionCheckedAt = Date.now();
    return;
  }
  if (state.refreshable && (await refreshSession()) === 'ok') {
    sessionCheckedAt = Date.now();
    return;
  }
  notifyUnauthenticated();
  throw new ApiError({ status: 401, code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' });
}

async function attempt<T>(path: string, body: FormData, handlers: UploadHandlers): Promise<Attempt<T>> {
  const token = await ensureCsrfToken();
  return new Promise<Attempt<T>>((resolve, reject) => {
    if (handlers.signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl(path));
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('X-CSRF-Token', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) handlers.onProgress?.(event.loaded, event.total);
    };
    xhr.upload.onload = () => handlers.onSent?.();
    xhr.onload = () => {
      const header = (name: string) => xhr.getResponseHeader(name);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({ ok: true, data: (xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T });
        } catch {
          resolve({ ok: false, error: new ApiError({ status: xhr.status, code: 'UNKNOWN_ERROR', message: 'The server sent an unexpected response.' }) });
        }
        return;
      }
      resolve({ ok: false, error: errorFromBody(xhr.status, xhr.responseText, header, xhr.statusText) });
    };
    xhr.onerror = () => resolve({ ok: false, error: networkError() });
    xhr.ontimeout = () => resolve({ ok: false, error: networkError() });
    xhr.onabort = () => reject(abortError());
    handlers.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** POSTs a multipart body to `/api<path>` and resolves with the parsed JSON response. */
export async function uploadWithProgress<T>(path: string, body: FormData, handlers: UploadHandlers = {}): Promise<T> {
  await ensureSession();
  let result = await attempt<T>(path, body, handlers);
  if (!result.ok && result.error.status === 401 && result.error.is('UNAUTHORIZED', 'SESSION_EXPIRED')) {
    const refreshed = await refreshSession();
    if (refreshed !== 'ok') {
      if (refreshed === 'expired') notifyUnauthenticated();
      throw refreshed === 'expired' ? result.error : networkError();
    }
    handlers.onProgress?.(0, 1);
    result = await attempt<T>(path, body, handlers);
    if (!result.ok && result.error.status === 401) notifyUnauthenticated();
  } else if (!result.ok && result.error.is('CSRF_INVALID')) {
    await fetchCsrfToken(true);
    handlers.onProgress?.(0, 1);
    result = await attempt<T>(path, body, handlers);
  }
  if (!result.ok) throw result.error;
  return result.data;
}
