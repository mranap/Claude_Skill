import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | undefined) => (v && UUID.test(v) ? v : null);

/**
 * Technical log of every Meta API call (no tokens, no payloads with secrets). Entries are buffered and
 * written in batches to keep the hot path fast.
 */
@Injectable()
export class MetaApiLogService implements BeforeApplicationShutdown {
  private readonly logger = new AppLogger('MetaApiLog');
  private buffer: Prisma.MetaApiLogCreateManyInput[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  record(e: MetaApiLogEntry): void {
    this.buffer.push({
      // Unsaved connections (token/proxy tests) use a pseudo profile id; only real ids reference a profile.
      userId: uuidOrNull(e.userId),
      profileId: uuidOrNull(e.profileId),
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
      usage: (e.usage ?? undefined),
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
      // One bad row must not cost the whole batch: fall back to row-by-row inserts.
      let dropped = 0;
      for (const row of batch) await this.prisma.metaApiLog.create({ data: row }).catch(() => dropped++);
      if (dropped) this.logger.error('Failed to write Meta API logs', { err, dropped, count: batch.length });
    }
  }

  /** Shutdown phase 2: write the remaining buffered log rows before PostgreSQL disconnects. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.flush();
  }
}
