import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@adpilot/shared';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error';
import { RequestContext } from '../context/request-context';
import { AppLogger } from '../../infra/logger/logger';

/**
 * Centralised exception handling. Every error leaves the API in the same shape (`ApiErrorBody`);
 * unexpected errors are logged with a request id and never leak internals to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new AppLogger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = RequestContext.get()?.requestId;

    const { status, body } = this.toBody(exception, requestId);
    if (status >= 500) {
      this.logger.error('Unhandled error', { err: exception, path: req.path, method: req.method });
    }
    if (body.error.retryAfterSeconds) {
      res.setHeader('Retry-After', String(Math.ceil(body.error.retryAfterSeconds)));
    }
    if (!res.headersSent) res.status(status).json(body);
  }

  private toBody(exception: unknown, requestId?: string): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details,
            meta: exception.meta,
            retryAfterSeconds: exception.retryAfterSeconds,
          },
          requestId,
        },
      };
    }
    if (exception instanceof ZodError) {
      return {
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Some fields are invalid',
            details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
          requestId,
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === 404
          ? 'NOT_FOUND'
          : status === 401
            ? 'UNAUTHORIZED'
            : status === 403
              ? 'FORBIDDEN'
              : status === 413
                ? 'PAYLOAD_TOO_LARGE'
                : status === 429
                  ? 'RATE_LIMITED'
                  : status >= 500
                    ? 'INTERNAL_ERROR'
                    : 'BAD_REQUEST';
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof (response as { message?: unknown }).message === 'string'
            ? (response as { message: string }).message
            : exception.message;
      return { status, body: { error: { code, message: status >= 500 ? 'Internal server error' : message }, requestId } };
    }
    const maybeBodyParser = exception as { type?: string; status?: number };
    if (maybeBodyParser?.type === 'entity.too.large') {
      return { status: 413, body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }, requestId } };
    }
    if (maybeBodyParser?.type === 'entity.parse.failed') {
      return { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' }, requestId } };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again or contact support.' },
        requestId,
      },
    };
  }
}
