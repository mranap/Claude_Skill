import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { idempotencyKeySchema } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { BulkActionJob, JOBS, QUEUES } from '../../infra/queue/queues';
import { LockService } from '../../infra/locks/lock.service';
import { AppLogger } from '../../infra/logger/logger';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../infra/prisma/prisma-errors';
import { MetaApiError } from '../meta/graph/meta-errors';
import { EntityActionsService } from './entity-actions.service';
import { Prisma, type BulkOperation } from '../../generated/prisma/client';

export const bulkStatusSchema = z.object({
  level: z.enum(['CAMPAIGN', 'ADSET', 'AD']),
  ids: z.array(z.uuid()).min(1).max(500),
  status: z.enum(['ACTIVE', 'PAUSED']),
  idempotencyKey: idempotencyKeySchema,
  /** Required for more than 1 object or for starting objects (UI confirmation dialog). */
  confirmed: z.literal(true),
});

const SYNC_LIMIT = 5;
/** Attempts of a BULK_ACTION job. An operation whose job ran out of them is closed by the outbox sweep. */
export const BULK_JOB_ATTEMPTS = 5;
/** Delay before the queue continues an inline run that stopped on an error. */
const RESUME_DELAY_MS = 30_000;
/** How long a second execution of the same operation waits for the first one. */
const BUSY_RETRY_MS = 30_000;
const LOCK_TTL_MS = 60_000;

export interface TargetResult {
  id: string;
  name?: string;
  ok: boolean;
  changed?: boolean;
  error?: string;
}

export function bulkJobId(operationId: string): string {
  return jobId('bulk', operationId);
}

/** Final status and counters: SUCCESS unless nothing succeeded (per-target failures are listed in the results). */
export function bulkOutcome(results: TargetResult[]) {
  const succeeded = results.filter((r) => r.ok).length;
  return { status: succeeded === 0 && results.length ? ('FAILED' as const) : ('SUCCESS' as const), succeeded, failed: results.length - succeeded };
}

/**
 * Closes an operation whose job ran out of attempts (outbox sweep): targets without a result are reported as
 * failed, so the operation reaches a final state instead of staying RUNNING. The technical reason is already
 * in the system log (failed job); the user sees what to do.
 */
export async function closeBulkOperation(prisma: PrismaService, op: BulkOperation): Promise<void> {
  const results = ((op.results as unknown as TargetResult[] | null) ?? []).slice();
  const done = new Set(results.map((r) => r.id));
  const error = 'Not confirmed: the operation stopped after repeated errors. Check the current status before trying again.';
  for (const id of op.targetIds) if (!done.has(id)) results.push({ id, ok: false, error });
  await prisma.bulkOperation.updateMany({
    where: { id: op.id, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { ...bulkOutcome(results), results: results as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
  });
}

/**
 * Bulk pause/start with safeguards: explicit confirmation, idempotency key (no double execution),
 * ownership check of every id, sequential execution through the rate-limited Meta client, per-target results.
 * Small batches run inline; larger ones, and whatever an inline run could not finish, run in the bulk-actions
 * queue. The outbox sweep re-queues operations whose job was lost.
 */
@Injectable()
export class BulkActionsService {
  private readonly logger = new AppLogger('BulkActions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly actions: EntityActionsService,
    private readonly locks: LockService,
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
    if (op.total > SYNC_LIMIT) {
      await this.enqueue(op.id, userId);
      return op;
    }
    // What a rate limit or an error leaves unfinished continues in the queue: the operation never stays
    // RUNNING without a job that finishes it.
    let delayMs: number | undefined;
    try {
      delayMs = (await this.process(op.id)).rateLimitedMs;
    } catch (err) {
      this.logger.warn('Inline bulk action stopped; the queue continues it', { bulkOperationId: op.id, err: String(err) });
      delayMs = RESUME_DELAY_MS;
    }
    if (delayMs) await this.enqueue(op.id, userId, delayMs);
    return this.prisma.bulkOperation.findUniqueOrThrow({ where: { id: op.id } });
  }

  async get(userId: string, id: string) {
    const op = await this.prisma.bulkOperation.findFirst({ where: { id, userId } });
    if (!op) throw AppError.notFound('Bulk operation');
    return op;
  }

  /**
   * Processes remaining targets; safe to call repeatedly (already processed targets are skipped). One execution
   * per operation at a time. `rateLimitedMs`: call again after that delay (Meta throttled the account, or
   * another execution of this operation is still running).
   */
  async process(id: string): Promise<{ rateLimitedMs?: number }> {
    const run = await this.locks.withLock(`bulk-operation:${id}`, LOCK_TTL_MS, () => this.processTargets(id));
    return run.acquired ? run.result : { rateLimitedMs: BUSY_RETRY_MS };
  }

  private async processTargets(id: string): Promise<{ rateLimitedMs?: number }> {
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
    await this.prisma.bulkOperation.update({ where: { id }, data: { ...bulkOutcome(results), finishedAt: new Date() } });
    return {};
  }

  private async enqueue(id: string, userId: string, delayMs = 0): Promise<void> {
    const data: BulkActionJob = { bulkOperationId: id, userId };
    await this.queue.add(QUEUES.BULK_ACTIONS, JOBS.BULK_ACTION, data, { jobId: bulkJobId(id), attempts: BULK_JOB_ATTEMPTS, delay: delayMs });
  }

  private async save(id: string, results: TargetResult[]) {
    const { succeeded, failed } = bulkOutcome(results);
    await this.prisma.bulkOperation.update({
      where: { id },
      data: { results: results as unknown as Prisma.InputJsonValue, succeeded, failed },
    });
  }
}
