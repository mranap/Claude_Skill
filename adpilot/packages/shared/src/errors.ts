/** Machine-readable error codes returned by the API in `{ error: { code, message } }`. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'COOLDOWN',
  'CSRF_INVALID',
  'ACCOUNT_LOCKED',
  'ACCOUNT_BLOCKED',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'PASSWORD_CHANGE_REQUIRED',
  'QUOTA_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'META_API_ERROR',
  'META_RATE_LIMITED',
  'META_AUTH_ERROR',
  'META_PERMISSION_ERROR',
  'PROXY_ERROR',
  'INTEGRATION_NOT_CONFIGURED',
  'MAINTENANCE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Details about a failed Meta Graph API call, safe to show to the account owner. */
export interface MetaErrorDetails {
  /** Human friendly explanation produced by the platform. */
  friendlyMessage: string;
  /** Meta's own user-facing title/message (error_user_title / error_user_msg) when provided. */
  userTitle?: string;
  userMessage?: string;
  /** Technical details (shown in a collapsible "Technical details" block). */
  code?: number;
  subcode?: number;
  type?: string;
  message?: string;
  fbtraceId?: string;
  httpStatus?: number;
  category: MetaErrorCategory;
  retryable: boolean;
  retryAfterMs?: number;
}

export const META_ERROR_CATEGORIES = [
  'RATE_LIMIT',
  'AUTH',
  'PERMISSION',
  'VALIDATION',
  'POLICY',
  'NOT_FOUND',
  'TRANSIENT',
  'NETWORK',
  'PROXY',
  'UNKNOWN',
] as const;
export type MetaErrorCategory = (typeof META_ERROR_CATEGORIES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    meta?: MetaErrorDetails;
    retryAfterSeconds?: number;
  };
  requestId?: string;
}
