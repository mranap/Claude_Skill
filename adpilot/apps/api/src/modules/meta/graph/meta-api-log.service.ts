import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AppLogger } from '../../../infra/logger/logger';
import { sanitizeString } from '../../../infra/logger/sanitize';
import { Prisma } from '../../../generated/prisma/client';

export interface MetaApiLogEntry {
  userId?: string;
  profileId?: string;
  metaAccountId?: string;
  method: string;
  category: string;
  path: string;
  httpStatus?: number;
  errorCode?: number;
  errorSubcode?: number;
  errorType?: string;
  errorMessage?: string;
  fbtraceId?: string;
  durationMs: number;
  retryCount: number;
  rateLimited: boolean;
  usage?: unknown;
  jobId?: string;
}

/**
 * Technical log of every Meta API call (no tokens, no payloads with secrets). Entries are buffered and
 * written in batches to keep the hot path fast.
 */
@Injectable()
export class MetaApiLogService implements OnModuleDestroy {
  private readonly logger = new AppLogger('MetaApiLog');
  private buffer: Prisma.MetaApiLogCreateManyInput[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  record(e: MetaApiLogEntry): void {
    this.buffer.push({
      userId: e.userId ?? null,
      profileId: e.profileId ?? null,
      metaAccountId: e.metaAccountId ?? null,
      method: e.method,
      category: e.category,
      path: sanitizeString(e.path).slice(0, 300),
      httpStatus: e.httpStatus ?? null,
      errorCode: e.errorCode ?? null,
      errorSubcode: e.errorSubcode ?? null,
      errorType: e.errorType ?? null,
      errorMessage: e.errorMessage ? sanitizeString(e.errorMessage).slice(0, 1000) : null,
      fbtraceId: e.fbtraceId ?? null,
      durationMs: Math.round(e.durationMs),
      retryCount: e.retryCount,
      rateLimited: e.rateLimited,
      usage: (e.usage ?? undefined) as Prisma.InputJsonValue | undefined,
      jobId: e.jobId ?? null,
    });
    if (this.buffer.length >= 100) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), 2000);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.prisma.metaApiLog.createMany({ data: batch });
    } catch (err) {
      this.logger.error('Failed to write Meta API logs', { err, count: batch.length });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
