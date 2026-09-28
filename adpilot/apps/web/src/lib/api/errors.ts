import type { ApiErrorBody, ErrorCode, MetaErrorDetails } from '@adpilot/shared';

/** Server error codes plus the two failures that only exist on the client. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';

export interface FieldError {
  path: string;
  message: string;
}

export interface ApiErrorInit {
  status: number;
  code: ClientErrorCode;
  message: string;
  details?: unknown;
  meta?: MetaErrorDetails;
  retryAfterSeconds?: number;
  requestId?: string;
}

/** Error thrown by the API client for every non-2xx response (and for network failures). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details?: unknown;
  readonly meta?: MetaErrorDetails;
  readonly retryAfterSeconds?: number;
  readonly requestId?: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.meta = init.meta;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.requestId = init.requestId;
  }

  /** `details` of VALIDATION_ERROR responses: `[{ path, message }]`. */
  get fieldErrors(): FieldError[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is FieldError =>
        !!d && typeof d === 'object' && typeof (d as FieldError).path === 'string' && typeof (d as FieldError).message === 'string',
    );
  }

  is(...codes: ClientErrorCode[]): boolean {
    return codes.includes(this.code);
  }
}

export function isApiError(error: unknown, ...codes: ClientErrorCode[]): error is ApiError {
  return error instanceof ApiError && (codes.length === 0 || codes.includes(error.code));
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    !!(value as ApiErrorBody).error &&
    typeof (value as ApiErrorBody).error.code === 'string'
  );
}

/** Builds an ApiError from a failed fetch Response. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  return errorFromBody(res.status, text, (name) => res.headers.get(name), res.statusText);
}

/** Builds an ApiError from a raw status + body (shared by `fetch` and `XMLHttpRequest` uploads). */
export function errorFromBody(status: number, text: string, header: (name: string) => string | null, statusText = ''): ApiError {
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const retryHeader = Number(header('Retry-After'));
  if (isErrorBody(body)) {
    return new ApiError({
      status,
      code: body.error.code,
      message: body.error.message || statusText,
      details: body.error.details,
      meta: body.error.meta,
      retryAfterSeconds: body.error.retryAfterSeconds ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
      requestId: body.requestId ?? header('X-Request-Id') ?? undefined,
    });
  }
  return new ApiError({
    status,
    code: status >= 500 ? 'INTERNAL_ERROR' : status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNKNOWN_ERROR',
    message:
      status === 502 || status === 503 || status === 504
        ? 'The server is temporarily unavailable. Please try again in a moment.'
        : status === 413
          ? 'The file is too large for the server.'
          : `Request failed (HTTP ${status})`,
    requestId: header('X-Request-Id') ?? undefined,
  });
}

function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/** User-facing message for any thrown value. Server messages are already written for end users. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.meta?.friendlyMessage) return error.meta.friendlyMessage;
    if ((error.code === 'RATE_LIMITED' || error.code === 'COOLDOWN') && error.retryAfterSeconds) {
      const base = error.message.replace(/\s*Please try again later\.?$/i, '');
      return `${base} Try again in ${humanDuration(error.retryAfterSeconds)}.`;
    }
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Short title for alerts and toasts. */
export function getErrorTitle(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong';
  switch (error.code) {
    case 'NETWORK_ERROR':
      return 'Connection problem';
    case 'FORBIDDEN':
      return 'Access denied';
    case 'NOT_FOUND':
      return 'Not found';
    case 'VALIDATION_ERROR':
    case 'BAD_REQUEST':
      return 'Please check the form';
    case 'CONFLICT':
      return 'Conflict';
    case 'RATE_LIMITED':
    case 'COOLDOWN':
      return 'Too many requests';
    case 'MAINTENANCE':
      return 'Maintenance in progress';
    case 'INTEGRATION_NOT_CONFIGURED':
      return 'Not configured';
    case 'META_API_ERROR':
    case 'META_AUTH_ERROR':
    case 'META_PERMISSION_ERROR':
    case 'META_RATE_LIMITED':
      return error.meta?.userTitle ?? 'Meta API error';
    case 'CSRF_INVALID':
      return 'Security check failed';
    case 'ACCOUNT_LOCKED':
      return 'Temporarily locked';
    case 'ACCOUNT_BLOCKED':
      return 'Account blocked';
    case 'MFA_INVALID':
      return 'Verification failed';
    case 'QUOTA_EXCEEDED':
      return 'Storage limit reached';
    case 'PAYLOAD_TOO_LARGE':
      return 'File too large';
    case 'UNSUPPORTED_MEDIA_TYPE':
      return 'Unsupported file type';
    case 'PROXY_ERROR':
      return 'Proxy error';
    case 'SESSION_EXPIRED':
    case 'UNAUTHORIZED':
      return 'Signed out';
    default:
      return 'Something went wrong';
  }
}
