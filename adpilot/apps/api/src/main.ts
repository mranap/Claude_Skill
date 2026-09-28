import './bootstrap/polyfills';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { NestPinoLogger } from './infra/logger/nest-logger';
import { getRootLogger } from './infra/logger/logger';
import { configureHttpApp, installGracefulShutdown } from './bootstrap/http-app';

async function bootstrap(): Promise<void> {
  process.env.ADPILOT_PROCESS ??= 'api';
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestPinoLogger(),
    bodyParser: false,
  });
  configureHttpApp(app);
  installGracefulShutdown(app);
  await app.listen(env.API_PORT, env.API_HOST);
  getRootLogger().info({ port: env.API_PORT, metaApiVersion: env.META_GRAPH_API_VERSION }, 'API listening');
}

bootstrap().catch((err: unknown) => {
  getRootLogger().fatal(
    { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
    'API failed to start',
  );
  process.exit(1);
});
