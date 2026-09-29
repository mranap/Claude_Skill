import './bootstrap/polyfills';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { NestPinoLogger } from './infra/logger/nest-logger';
import { getRootLogger } from './infra/logger/logger';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  process.env.ADPILOT_PROCESS ??= 'worker';
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new NestPinoLogger() });
  app.enableShutdownHooks();
  getRootLogger().info(
    { queues: env.WORKER_QUEUES, metaApiVersion: env.META_GRAPH_API_VERSION },
    'Worker started',
  );
}

bootstrap().catch((err: unknown) => {
  getRootLogger().fatal(
    { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
    'Worker failed to start',
  );
  process.exit(1);
});
