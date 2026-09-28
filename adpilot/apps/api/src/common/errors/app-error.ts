import type { ErrorCode, MetaErrorDetails } from '@adpilot/shared';

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  SESSION_EXPIRED: 401,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  ACCOUNT_BLOCKED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  COOLDOWN: 429,
  META_RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 422,
  META_API_ERROR: 422,
  META_AUTH_ERROR: 422,
  META_PERMISSION_ERROR: 422,
  PROXY_ERROR: 502,
  INTEGRATION_NOT_CONFIGURED: 409,
  MAINTENANCE: 503,
  INTERNAL_ERROR: 500,
};

/** Application error with a stable machine code and a message that is safe to show to the user. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options?: { status?: number; meta?: MetaErrorDetails; retryAfterSeconds?: number; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.status = options?.status ?? STATUS_BY_CODE[code] ?? 400;
    this.meta = options?.meta;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }

  readonly meta?: MetaErrorDetails;
  readonly retryAfterSeconds?: number;

  static notFound(what = 'Resource'): AppError {
    return new AppError('NOT_FOUND', `${what} not found`);
  }
  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, details);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, details);
  }
  static cooldown(message: string, retryAfterSeconds: number): AppError {
    return new AppError('COOLDOWN', message, undefined, { retryAfterSeconds });
  }
  static rateLimited(
    retryAfterSeconds: number,
    message = 'Too many requests. Please try again later.',
  ): AppError {
    return new AppError('RATE_LIMITED', message, undefined, { retryAfterSeconds });
  }
}
