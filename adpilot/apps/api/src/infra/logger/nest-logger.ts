import { LoggerService } from '@nestjs/common';
import { getRootLogger } from './logger';

/** Bridges Nest's internal logging to pino so framework messages are structured as well. */
export class NestPinoLogger implements LoggerService {
  private readonly logger = getRootLogger().child({ context: 'nest' });

  log(message: unknown, ...optional: unknown[]): void {
    this.logger.info({ ctx: optional.at(-1) }, String(message));
  }
  error(message: unknown, ...optional: unknown[]): void {
    this.logger.error({ ctx: optional.at(-1), trace: optional[0] }, String(message));
  }
  warn(message: unknown, ...optional: unknown[]): void {
    this.logger.warn({ ctx: optional.at(-1) }, String(message));
  }
  debug(message: unknown, ...optional: unknown[]): void {
    this.logger.debug({ ctx: optional.at(-1) }, String(message));
  }
  verbose(message: unknown, ...optional: unknown[]): void {
    this.logger.trace({ ctx: optional.at(-1) }, String(message));
  }
}
