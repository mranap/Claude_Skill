import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { JobType } from 'bullmq';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { RedisService } from '../../infra/redis/redis.service';
import { ALL_QUEUES, JOBS, QUEUES, QueueName } from '../../infra/queue/queues';
import { sanitize } from '../../infra/logger/sanitize';
import { AuditService } from '../audit/audit.service';
import { BackupService } from '../maintenance/backup.service';
import { MetaRateLimitService } from '../meta/graph/rate-limit.service';
import { StorageService } from '../storage/storage.service';
import { SystemHealthService } from './system-health.service';
import type { AuthUser } from '../auth/auth.types';

const JOB_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused', 'prioritized'] as const;
const jobsQuerySchema = z.object({
  state: z.enum(JOB_STATES).default('failed'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const cleanSchema = z.object({ state: z.enum(['completed', 'failed']), olderThanHours: z.number().int().min(0).max(24 * 90) });

/** Operations: dashboard counters, health, queues/jobs, workers, rate limits, storage, backups. */
@Controller('admin')
export class AdminOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly health: SystemHealthService,
    private readonly rateLimits: MetaRateLimitService,
    private readonly storage: StorageService,
    private readonly backups: BackupService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('admin.dashboard.view')
  async dashboard() {
    const since24h = new Date(Date.now() - 86400_000);
    const [users, profiles, adAccounts, connectedAccounts, campaigns, files, launches24h, failedLaunches24h, apiErrors24h, rateLimited24h, workerErrors24h] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.metaProfile.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.adAccount.count(),
      this.prisma.adAccount.count({ where: { isConnected: true } }),
      this.prisma.campaign.count({ where: { isDeleted: false } }),
      this.prisma.creativeFile.aggregate({ where: { deletedAt: null }, _count: { _all: true }, _sum: { sizeBytes: true } }),
      this.prisma.launchJob.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.launchJob.count({ where: { createdAt: { gte: since24h }, status: { in: ['FAILED', 'PARTIAL_FAILURE'] } } }),
      this.prisma.metaApiLog.count({ where: { createdAt: { gte: since24h }, OR: [{ errorCode: { not: null } }, { httpStatus: { gte: 400 } }] } }),
      this.prisma.metaApiLog.count({ where: { createdAt: { gte: since24h }, rateLimited: true } }),
      this.prisma.systemLog.count({ where: { createdAt: { gte: since24h }, level: 'ERROR' } }),
    ]);
    const queueCounts = await this.queueSummary();
    return {
      users: Object.fromEntries(users.map((u) => [u.status, u._count._all])),
      metaProfiles: Object.fromEntries(profiles.map((p) => [p.status, p._count._all])),
      adAccounts: { total: adAccounts, connected: connectedAccounts },
      campaigns,
      files: { count: files._count._all, bytes: (files._sum.sizeBytes ?? 0n).toString() },
      launches24h: { total: launches24h, failed: failedLaunches24h },
      metaApi24h: { errors: apiErrors24h, rateLimited: rateLimited24h },
      workerErrors24h,
      queues: queueCounts,
    };
  }

  @Get('health')
  @RequirePermissions('admin.dashboard.view')
  async systemHealth(@Query('deep') deep?: string) {
    return this.health.check({ deep: deep === 'true' });
  }

  @Get('queues')
  @RequirePermissions('admin.workers.view')
  async queueList() {
    return this.queueSummary();
  }

  @Get('queues/:name/jobs')
  @RequirePermissions('admin.workers.view')
  async jobs(@Param('name') name: string, @Query(zod(jobsQuerySchema)) q: z.infer<typeof jobsQuerySchema>) {
    const queue = this.queues.queue(this.assertQueue(name));
    const start = (q.page - 1) * q.pageSize;
    const [jobs, counts] = await Promise.all([
      queue.getJobs([q.state as JobType], start, start + q.pageSize - 1, false),
      queue.getJobCounts(q.state),
    ]);
    return {
      items: jobs.filter(Boolean).map((j) => ({
        id: j.id,
        name: j.name,
        data: jobDataForAdmin(j.data),
        attemptsMade: j.attemptsMade,
        maxAttempts: j.opts.attempts,
        failedReason: j.failedReason,
        stacktrace: (j.stacktrace ?? []).slice(-1).map((s) => sanitize(s).slice(0, 2000)),
        timestamp: j.timestamp,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
        delay: j.delay,
      })),
      total: counts[q.state] ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  @Post('queues/:name/jobs/:id/retry')
  @HttpCode(200)
  @RequirePermissions('admin.workers.manage')
  async retry(@CurrentUser() user: AuthUser, @Param('name') name: string, @Param('id') id: string) {
    const job = await this.queues.queue(this.assertQueue(name)).getJob(id);
    if (!job) throw AppError.notFound('Job');
    await job.retry('failed');
    await this.audit.log({ action: 'admin.queue.job_retried', actorUserId: user.id, targetType: 'job', targetId: `${name}/${id}` });
    return { ok: true };
  }

  @Delete('queues/:name/jobs/:id')
  @RequirePermissions('admin.workers.manage')
  async removeJob(@CurrentUser() user: AuthUser, @Param('name') name: string, @Param('id') id: string) {
    const job = await this.queues.queue(this.assertQueue(name)).getJob(id);
    if (!job) throw AppError.notFound('Job');
    await job.remove();
    await this.audit.log({ action: 'admin.queue.job_removed', actorUserId: user.id, targetType: 'job', targetId: `${name}/${id}` });
    return { ok: true };
  }

  @Post('queues/:name/pause')
  @HttpCode(200)
  @RequirePermissions('admin.workers.manage')
  async pause(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    await this.queues.queue(this.assertQueue(name)).pause();
    await this.audit.log({ action: 'admin.queue.paused', actorUserId: user.id, targetType: 'queue', targetId: name });
    return { ok: true };
  }

  @Post('queues/:name/resume')
  @HttpCode(200)
  @RequirePermissions('admin.workers.manage')
  async resume(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    await this.queues.queue(this.assertQueue(name)).resume();
    await this.audit.log({ action: 'admin.queue.resumed', actorUserId: user.id, targetType: 'queue', targetId: name });
    return { ok: true };
  }

  @Post('queues/:name/clean')
  @HttpCode(200)
  @RequirePermissions('admin.workers.manage')
  async clean(@CurrentUser() user: AuthUser, @Param('name') name: string, @Body(zod(cleanSchema)) body: z.infer<typeof cleanSchema>) {
    const removed = await this.queues.queue(this.assertQueue(name)).clean(body.olderThanHours * 3600_000, 10_000, body.state);
    await this.audit.log({ action: 'admin.queue.cleaned', actorUserId: user.id, targetType: 'queue', targetId: name, metadata: { ...body, removed: removed.length } });
    return { removed: removed.length };
  }

  @Get('workers')
  @RequirePermissions('admin.workers.view')
  async workers() {
    const [workers, schedulerRaw] = await Promise.all([this.health.workerHeartbeats(), this.redis.client.get(this.redis.key('scheduler', 'hb'))]);
    return { workers, scheduler: schedulerRaw ? JSON.parse(schedulerRaw) : null };
  }

  @Get('meta-rate-limits')
  @RequirePermissions('admin.workers.view')
  rateLimitSnapshot() {
    return this.rateLimits.snapshot();
  }

  @Get('storage')
  @RequirePermissions('admin.storage.manage')
  async storageStats() {
    const [byType, topUsers, check] = await Promise.all([
      this.prisma.creativeFile.groupBy({ by: ['type'], where: { deletedAt: null }, _count: { _all: true }, _sum: { sizeBytes: true } }),
      this.prisma.user.findMany({ where: { storageUsedBytes: { gt: 0 } }, orderBy: { storageUsedBytes: 'desc' }, take: 10, select: { id: true, email: true, storageUsedBytes: true, storageQuotaBytes: true } }),
      this.storage.check(),
    ]);
    return {
      bucket: this.storage.bucket,
      check,
      byType: byType.map((t) => ({ type: t.type, count: t._count._all, bytes: (t._sum.sizeBytes ?? 0n).toString() })),
      topUsers,
    };
  }

  @Get('backups')
  @RequirePermissions('admin.backups.manage')
  listBackups() {
    return this.backups.list();
  }

  @Post('backups')
  @HttpCode(202)
  @RequirePermissions('admin.backups.manage')
  async runBackup(@CurrentUser() user: AuthUser) {
    const res = await this.backups.request(user.id);
    await this.audit.log({ action: 'admin.backup.requested', actorUserId: user.id, targetType: 'backup', targetId: res.id });
    return res;
  }

  @Post('maintenance/retention')
  @HttpCode(202)
  @RequirePermissions('admin.maintenance.manage')
  async runRetention(@CurrentUser() user: AuthUser) {
    await this.queues.add(QUEUES.MAINTENANCE, JOBS.RETENTION_CLEANUP, { kind: 'retention' }, { attempts: 1 });
    await this.audit.log({ action: 'admin.retention.requested', actorUserId: user.id });
    return { queued: true };
  }

  private assertQueue(name: string): QueueName {
    if (!ALL_QUEUES.includes(name as QueueName)) throw AppError.notFound('Queue');
    return name as QueueName;
  }

  private async queueSummary() {
    return Promise.all(
      this.queues.all().map(async ({ name, queue }) => ({
        name,
        paused: await queue.isPaused(),
        counts: await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused', 'prioritized'),
      })),
    );
  }
}

/**
 * Job payload shown in the admin queue viewer: message contents (e-mail bodies, Telegram texts, sealed
 * one-time links) are replaced by their size, everything else is passed through the secret sanitizer.
 */
function jobDataForAdmin(data: unknown): unknown {
  if (!data || typeof data !== 'object') return sanitize(data);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    out[key] = ['html', 'text', 'sealed'].includes(key) && typeof value === 'string' ? `[${value.length} characters]` : value;
  }
  return sanitize(out);
}
