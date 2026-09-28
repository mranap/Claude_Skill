import './bootstrap/polyfills';
import { NestFactory } from '@nestjs/core';
import { SchedulerModule } from './scheduler.module';
import { NestPinoLogger } from './infra/logger/nest-logger';
import { getRootLogger } from './infra/logger/logger';

async function bootstrap(): Promise<void> {
  process.env.ADPILOT_PROCESS ??= 'scheduler';
  const app = await NestFactory.createApplicationContext(SchedulerModule, { logger: new NestPinoLogger() });
  app.enableShutdownHooks();
  getRootLogger().info('Scheduler started');
}

bootstrap().catch((err: unknown) => {
  getRootLogger().fatal({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, 'Scheduler failed to start');
  process.exit(1);
});
