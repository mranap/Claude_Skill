import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../context/request-context';
import { getRootLogger } from '../../infra/logger/logger';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Assigns a request id, runs the request inside the async context and writes one access-log line. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  const ua = req.headers['user-agent'];
  RequestContext.run({ requestId, ip: req.ip, userAgent: typeof ua === 'string' ? ua : undefined }, () => {
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const ctx = RequestContext.get();
      const line = {
        requestId,
        userId: ctx?.userId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(ms),
      };
      const logger = getRootLogger();
      if (res.statusCode >= 500) logger.error(line, 'request');
      else if (req.path !== '/api/health') logger.info(line, 'request');
    });
    next();
  });
}
