import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { sanitize } from '../../infra/logger/sanitize';
import { AppLogger } from '../../infra/logger/logger';
import { RequestContext } from '../../common/context/request-context';
import { Prisma } from '../../generated/prisma/client';

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Operational events worth showing in the admin "System logs" page (worker failures, scheduler problems,
 * integration errors). Everything is also written to stdout as structured JSON.
 */
@Injectable()
export class SystemLogService {
  private readonly logger = new AppLogger('SystemLog');

  constructor(private readonly prisma: PrismaService) {}

  async write(level: Level, source: string, message: string, context?: Record<string, unknown>, userId?: string): Promise<void> {
    const ctx = RequestContext.get();
    const payload = context ? (sanitize(context) as Prisma.InputJsonValue) : undefined;
    if (level === 'ERROR') this.logger.error(message, { source, ...context });
    else if (level === 'WARN') this.logger.warn(message, { source, ...context });
    try {
      await this.prisma.systemLog.create({
        data: {
          level,
          source,
          message: message.slice(0, 2000),
          context: payload,
          userId: userId ?? ctx?.userId ?? null,
          jobId: ctx?.jobId ?? null,
        },
      });
    } catch (err) {
      this.logger.error('Failed to persist system log', { err });
    }
  }

  error(source: string, message: string, context?: Record<string, unknown>, userId?: string) {
    return this.write('ERROR', source, message, context, userId);
  }
  warn(source: string, message: string, context?: Record<string, unknown>, userId?: string) {
    return this.write('WARN', source, message, context, userId);
  }
  info(source: string, message: string, context?: Record<string, unknown>, userId?: string) {
    return this.write('INFO', source, message, context, userId);
  }
}
