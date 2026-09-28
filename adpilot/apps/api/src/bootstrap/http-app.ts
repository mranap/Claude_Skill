import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Server } from 'node:http';
import { AppConfig } from '../config/app-config';
import { requestContextMiddleware } from '../common/http/request-context.middleware';
import { getRootLogger } from '../infra/logger/logger';

/**
 * HTTP pipeline of the API process (security headers, cookies, body limits, CORS, timeouts).
 * Shared by `main.ts` and the integration tests so tests exercise exactly the production setup.
 */
export function configureHttpApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.set('trust proxy', config.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(requestContextMiddleware);
  app.use(
    helmet({
      // The API only returns JSON; nothing may be framed or executed from it.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '256kb' });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  // Large creative uploads (videos up to several GB) must not be cut by Node's default 5 minute timeout.
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 2 * 60 * 60 * 1000;
  server.headersTimeout = 70_000;
  server.keepAliveTimeout = 65_000;
}

/**
 * Graceful shutdown of the API process (SIGTERM from Docker / SIGINT):
 *  1. stop accepting connections and let in-flight requests finish (bounded by `drainTimeoutMs`);
 *  2. run the Nest shutdown sequence (flush buffers, close queues, then Redis/PostgreSQL);
 *  3. exit. A second signal forces an immediate exit.
 */
export function installGracefulShutdown(app: NestExpressApplication, drainTimeoutMs = 20_000): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    const logger = getRootLogger();
    if (shuttingDown) {
      logger.warn({ signal }, 'Second shutdown signal received, exiting immediately');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down: draining HTTP connections');
    const server = app.getHttpServer() as Server;
    const drained = new Promise<void>((resolve) => server.close(() => resolve()));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, drainTimeoutMs).unref());
    await Promise.race([drained, timeout]);
    server.closeAllConnections();
    try {
      await app.close();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', (s) => void shutdown(s));
  process.on('SIGINT', (s) => void shutdown(s));
}
