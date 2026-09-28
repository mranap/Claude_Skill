import pino, { Logger } from 'pino';
import { loadEnv } from '../../config/env';
import { RequestContext } from '../../common/context/request-context';
import { sanitize } from './sanitize';

let root: Logger | null = null;

/**
 * Structured JSON logger (pino). Every line carries the correlation context (requestId, userId, jobId,
 * queue) and is passed through `sanitize` so tokens/passwords never reach log storage.
 */
export function getRootLogger(): Logger {
  if (root) return root;
  const env = loadEnv();
  root = pino({
    level: env.LOG_LEVEL,
    base: { service: process.env.ADPILOT_PROCESS ?? 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.accessToken',
        '*.access_token',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    mixin() {
      const ctx = RequestContext.get();
      if (!ctx) return {};
      return { requestId: ctx.requestId, userId: ctx.userId, jobId: ctx.jobId, queue: ctx.queue };
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
  return root;
}

export class AppLogger {
  private readonly logger: Logger;

  constructor(context: string) {
    this.logger = getRootLogger().child({ context });
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.logger.debug(data ? sanitize(data) : {}, msg);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.logger.info(data ? sanitize(data) : {}, msg);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.logger.warn(data ? sanitize(data) : {}, msg);
  }
  error(msg: string, data?: Record<string, unknown> & { err?: unknown }): void {
    const { err, ...rest } = data ?? {};
    const payload: Record<string, unknown> = sanitize(rest);
    if (err) payload.err = serializeError(err);
    this.logger.error(payload, msg);
  }
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: sanitize(err.message),
      stack: err.stack ? sanitize(err.stack) : undefined,
    };
    const anyErr = err as unknown as Record<string, unknown>;
    for (const key of ['code', 'status', 'category', 'metaCode', 'metaSubcode']) {
      if (anyErr[key] !== undefined) out[key] = anyErr[key];
    }
    return out;
  }
  return { message: sanitize(String(err)) };
}
