import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { idempotencyKeySchema } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../infra/prisma/prisma-errors';
import { MetaApiError } from '../meta/graph/meta-errors';
import { EntityActionsService } from './entity-actions.service';
import { Prisma } from '../../generated/prisma/client';

export const bulkStatusSchema = z.object({
  level: z.enum(['CAMPAIGN', 'ADSET', 'AD']),
  ids: z.array(z.uuid()).min(1).max(500),
  status: z.enum(['ACTIVE', 'PAUSED']),
  idempotencyKey: idempotencyKeySchema,
  /** Required for more than 1 object or for starting objects (UI confirmation dialog). */
  confirmed: z.literal(true),
});

const SYNC_LIMIT = 5;

interface TargetResult {
  id: string;
  name?: string;
  ok: boolean;
  changed?: boolean;
  error?: string;
}

/**
 * Bulk pause/start with safeguards: explicit confirmation, idempotency key (no double execution),
 * ownership check of every id, sequential execution through the rate-limited Meta client, per-target results.
 * Small batches run inline; larger ones run in the bulk-actions queue.
 */
@Injectable()
export class BulkActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly actions: EntityActionsService,
  ) {}

  async requestStatus(userId: string, input: z.infer<typeof bulkStatusSchema>) {
    const existing = await this.prisma.bulkOperation.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;
    const table = input.level === 'CAMPAIGN' ? 'campaign' : input.level === 'ADSET' ? 'adSet' : 'ad';
    const owned = await (this.prisma[table] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: { id: { in: input.ids }, userId, isDeleted: false } });
    if (owned !== new Set(input.ids).size) throw AppError.notFound('Some selected objects');
    let op;
    try {
      op = await this.prisma.bulkOperation.create({
        data: {
          userId,
          idempotencyKey: input.idempotencyKey,
          level: input.level,
          action: input.status === 'PAUSED' ? 'PAUSE' : 'START',
          targetIds: [...new Set(input.ids)],
          total: new Set(input.ids).size,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return this.prisma.bulkOperation.findUniqueOrThrow({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
      throw err;
    }
    await this.audit.log({ action: 'bulk.status_requested', actorUserId: userId, subjectUserId: userId, targetType: 'bulk_operation', targetId: op.id, metadata: { level: input.level, status: input.status, count: op.total } });
    if (op.total <= SYNC_LIMIT) {
      await this.process(op.id);
      return this.prisma.bulkOperation.findUniqueOrThrow({ where: { id: op.id } });
    }
    await this.queue.add(QUEUES.BULK_ACTIONS, JOBS.BULK_ACTION, { bulkOperationId: op.id, userId }, { jobId: jobId('bulk', op.id), attempts: 5 });
    return op;
  }

  async get(userId: string, id: string) {
    const op = await this.prisma.bulkOperation.findFirst({ where: { id, userId } });
    if (!op) throw AppError.notFound('Bulk operation');
    return op;
  }

  /** Processes remaining targets; safe to call repeatedly (already processed targets are skipped). */
  async process(id: string): Promise<{ rateLimitedMs?: number }> {
    const op = await this.prisma.bulkOperation.findUniqueOrThrow({ where: { id } });
    if (op.status === 'SUCCESS' || op.status === 'FAILED') return {};
    await this.prisma.bulkOperation.update({ where: { id }, data: { status: 'RUNNING' } });
    const results = ((op.results as unknown as TargetResult[] | null) ?? []).slice();
    const done = new Set(results.map((r) => r.id));
    const status = op.action === 'PAUSE' ? 'PAUSED' : 'ACTIVE';
    for (const targetId of op.targetIds) {
      if (done.has(targetId)) continue;
      let result: TargetResult;
      try {
        const e = await this.actions.resolve(op.userId, op.level as 'CAMPAIGN' | 'ADSET' | 'AD', targetId);
        const res = await this.actions.setStatus(e, status, { source: 'BULK', actorUserId: op.userId });
        result = { id: targetId, name: e.name, ok: true, changed: res.changed };
      } catch (err) {
        const meta = (err as { meta?: { category?: string; retryAfterMs?: number } }).meta;
        if (meta?.category === 'RATE_LIMIT' || (err instanceof MetaApiError && err.category === 'RATE_LIMIT')) {
          await this.save(id, results);
          return { rateLimitedMs: meta?.retryAfterMs ?? 60_000 };
        }
        result = { id: targetId, ok: false, error: (err as Error).message };
      }
      results.push(result);
      await this.save(id, results);
    }
    const succeeded = results.filter((r) => r.ok).length;
    await this.prisma.bulkOperation.update({
      where: { id },
      data: { status: succeeded === 0 && results.length ? 'FAILED' : 'SUCCESS', succeeded, failed: results.length - succeeded, finishedAt: new Date() },
    });
    return {};
  }

  private async save(id: string, results: TargetResult[]) {
    const succeeded = results.filter((r) => r.ok).length;
    await this.prisma.bulkOperation.update({
      where: { id },
      data: { results: results as unknown as Prisma.InputJsonValue, succeeded, failed: results.length - succeeded },
    });
  }
}
