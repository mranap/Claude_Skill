import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { LAUNCH_JOB_TERMINAL_STATUSES, launchRequestSchema, paginationQuerySchema } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../infra/prisma/prisma-errors';
import { LaunchValidatorService } from './launch-validator.service';
import { PlanBuilderService } from './plan-builder.service';
import { Prisma } from '../../generated/prisma/client';
import type { LaunchPlan } from './launch.types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** Renders plan payload references as readable placeholders for the dry-run view. */
function displayPayload(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(displayPayload);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$ref === 'string')
      return `‹${typeof o.field === 'string' ? o.field : 'value'} of ${o.$ref}›`;
    return Object.fromEntries(Object.entries(o).map(([k, val]) => [k, displayPayload(val)]));
  }
  return v;
}

@Injectable()
export class LaunchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly validator: LaunchValidatorService,
    private readonly planner: PlanBuilderService,
  ) {}

  async validate(userId: string, config: unknown, draftId?: string) {
    const res = await this.validator.validate(userId, config);
    if (draftId) {
      await this.prisma.launchDraft.updateMany({
        where: { id: draftId, userId },
        data: {
          lastValidatedAt: new Date(),
          validationResult: {
            ok: res.ok,
            errors: res.errors,
            warnings: res.warnings,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return { ok: res.ok, errors: res.errors, warnings: res.warnings };
  }

  /** Dry run: validates and shows exactly which Meta objects would be created — nothing is sent to Meta. */
  async dryRun(userId: string, config: unknown) {
    const res = await this.validator.validate(userId, config);
    if (!res.ok || !res.context) return { ok: false, errors: res.errors, warnings: res.warnings };
    const plan = this.planner.build(res.context, 'DRYRUN');
    return {
      ok: true,
      errors: [],
      warnings: res.warnings,
      summary: plan.summary,
      items: plan.items.map((i) => ({
        key: i.key,
        kind: i.kind,
        name: i.name,
        parentKey: i.parentKey,
        payload: displayPayload(i.payload),
      })),
    };
  }

  /**
   * Starts a launch. Idempotent: the same idempotency key always returns the same job (double clicks,
   * network retries, two tabs). The job and all its items are created in one transaction before the
   * worker is notified.
   */
  async launch(userId: string, input: z.infer<typeof launchRequestSchema>) {
    const existing = await this.prisma.launchJob.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return { job: await this.get(userId, existing.id), duplicate: true };

    const res = await this.validator.validate(userId, input.config);
    if (!res.ok || !res.context) {
      throw AppError.validation('The launch configuration has errors', {
        errors: res.errors,
        warnings: res.warnings,
      });
    }
    const ctx = res.context;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const plan: LaunchPlan = this.planner.build(ctx, code);
      try {
        const job = await this.prisma.$transaction(async (tx) => {
          if (input.draftId) {
            const draft = await tx.launchDraft.findFirst({ where: { id: input.draftId, userId } });
            if (!draft) throw AppError.notFound('Draft');
            const moved = await tx.launchDraft.updateMany({
              where: { id: input.draftId, status: 'DRAFT' },
              data: { status: 'LAUNCHED' },
            });
            if (moved.count !== 1)
              throw AppError.conflict('This draft has already been launched. Clone it to launch again.');
          }
          const created = await tx.launchJob.create({
            data: {
              userId,
              draftId: input.draftId ?? null,
              templateId: ctx.config.templateId ?? null,
              profileId: ctx.profile.id,
              adAccountId: ctx.adAccount.id,
              idempotencyKey: input.idempotencyKey,
              code,
              name: ctx.config.name,
              plan: plan as unknown as Prisma.InputJsonValue,
              summary: plan.summary as unknown as Prisma.InputJsonValue,
              warnings: res.warnings as unknown as Prisma.InputJsonValue,
              activateOnSuccess: ctx.config.settings.activateOnSuccess,
              totalItems: plan.items.length,
            },
          });
          await tx.launchJobItem.createMany({
            data: plan.items.map((i, position) => ({
              launchJobId: created.id,
              kind: i.kind,
              key: i.key,
              parentKey: i.parentKey ?? null,
              position,
              name: i.name,
              request: i.payload as Prisma.InputJsonValue,
            })),
          });
          return created;
        });
        if (ctx.config.templateId) {
          await this.prisma.campaignTemplate.updateMany({
            where: { id: ctx.config.templateId, userId },
            data: { lastUsedAt: new Date() },
          });
        }
        await this.enqueue(job.id, userId, 0);
        await this.audit.log({
          action: 'campaign.launch_requested',
          actorUserId: userId,
          subjectUserId: userId,
          targetType: 'launch_job',
          targetId: job.id,
          metadata: {
            code,
            adAccount: ctx.adAccount.metaAccountId,
            adSets: plan.summary.adSets,
            ads: plan.summary.ads,
          },
        });
        return { job: await this.get(userId, job.id), duplicate: false };
      } catch (err) {
        if (
          isUniqueViolation(err, 'idempotencyKey') ||
          (isUniqueViolation(err) && String(err).includes('idempotency'))
        ) {
          const winner = await this.prisma.launchJob.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
          });
          if (winner) return { job: await this.get(userId, winner.id), duplicate: true };
        }
        if (isUniqueViolation(err, 'code')) continue; // extremely rare launch code collision
        throw err;
      }
    }
    throw new AppError('INTERNAL_ERROR', 'Could not allocate a launch code');
  }

  async list(userId: string, q: z.infer<typeof paginationQuerySchema>) {
    const where: Prisma.LaunchJobWhereInput = {
      userId,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: q.q.toUpperCase() }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.launchJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          progress: true,
          currentStep: true,
          totalItems: true,
          createdItems: true,
          failedItems: true,
          metaCampaignId: true,
          createdAt: true,
          finishedAt: true,
          adAccount: { select: { id: true, name: true, metaAccountId: true } },
        },
      }),
      this.prisma.launchJob.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(userId: string, id: string) {
    const job = await this.prisma.launchJob.findFirst({
      where: { id, userId },
      include: {
        items: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            kind: true,
            key: true,
            parentKey: true,
            name: true,
            status: true,
            metaId: true,
            attemptCount: true,
            lastError: true,
            errorCategory: true,
            updatedAt: true,
          },
        },
        adAccount: { select: { id: true, name: true, metaAccountId: true, currency: true } },
      },
    });
    if (!job) throw AppError.notFound('Launch');
    const { plan: _plan, ...rest } = job;
    return rest;
  }

  async cancel(userId: string, id: string) {
    const job = await this.prisma.launchJob.findFirst({ where: { id, userId } });
    if (!job) throw AppError.notFound('Launch');
    if (LAUNCH_JOB_TERMINAL_STATUSES.includes(job.status))
      throw AppError.conflict('This launch has already finished');
    await this.prisma.launchJob.update({ where: { id }, data: { cancelRequestedAt: new Date() } });
    await this.audit.log({
      action: 'campaign.launch_cancel_requested',
      actorUserId: userId,
      subjectUserId: userId,
      targetType: 'launch_job',
      targetId: id,
    });
    return { ok: true };
  }

  /** Retries failed/skipped steps of a finished launch (after the user fixed the cause). */
  async retry(userId: string, id: string) {
    const job = await this.prisma.launchJob.findFirst({ where: { id, userId } });
    if (!job) throw AppError.notFound('Launch');
    if (job.status !== 'FAILED' && job.status !== 'PARTIAL_FAILURE')
      throw AppError.conflict('Only failed launches can be retried');
    const moved = await this.prisma.launchJob.updateMany({
      where: { id, status: job.status },
      data: {
        status: 'QUEUED',
        finishedAt: null,
        error: Prisma.DbNull,
        cancelRequestedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    if (moved.count !== 1) throw AppError.conflict('The launch is already being retried');
    await this.prisma.launchJobItem.updateMany({
      where: { launchJobId: id, status: { in: ['FAILED', 'SKIPPED'] } },
      data: { status: 'PENDING', lastError: Prisma.DbNull, errorCategory: null },
    });
    // Every wait for Meta starts over (items still IN_FLIGHT keep their state and are verified first).
    await this.prisma.launchJobItem.updateMany({
      where: { launchJobId: id, deferredSince: { not: null } },
      data: { deferredSince: null },
    });
    await this.enqueue(id, userId, job.attempt + 1);
    await this.audit.log({
      action: 'campaign.launch_retried',
      actorUserId: userId,
      subjectUserId: userId,
      targetType: 'launch_job',
      targetId: id,
    });
    return this.get(userId, id);
  }

  private async enqueue(launchJobId: string, userId: string, round: number) {
    await this.queue.add(
      QUEUES.CAMPAIGN_LAUNCH,
      JOBS.CAMPAIGN_CREATE,
      { launchJobId, userId },
      { jobId: jobId('launch', launchJobId, round), attempts: 8 },
    );
  }
}
