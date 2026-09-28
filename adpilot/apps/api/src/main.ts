import './bootstrap/polyfills';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { NestPinoLogger } from './infra/logger/nest-logger';
import { getRootLogger } from './infra/logger/logger';
import { requestContextMiddleware } from './common/http/request-context.middleware';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  process.env.ADPILOT_PROCESS ??= 'api';
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestPinoLogger(),
    bodyParser: false,
  });
  const config = app.get(AppConfig);

  app.set('trust proxy', env.TRUST_PROXY);
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
  app.enableShutdownHooks();

  // Large creative uploads (videos up to several GB) must not be cut by Node's default 5 minute timeout.
  const server = app.getHttpServer() as import('node:http').Server;
  server.requestTimeout = 2 * 60 * 60 * 1000;
  server.headersTimeout = 70_000;
  server.keepAliveTimeout = 65_000;

  await app.listen(env.API_PORT, env.API_HOST);
  getRootLogger().info({ port: env.API_PORT, metaApiVersion: env.META_GRAPH_API_VERSION }, 'API listening');
}

bootstrap().catch((err: unknown) => {
  getRootLogger().fatal({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, 'API failed to start');
  process.exit(1);
});
