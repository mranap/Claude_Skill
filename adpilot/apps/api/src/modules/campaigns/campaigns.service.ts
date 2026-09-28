import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { z } from 'zod';
import {
  DATE_RANGE_KEYS,
  applyPercent,
  idempotencyKeySchema,
  majorToMinor,
  minorToMajor,
  paginationQuerySchema,
  type MetricsDto,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LockService } from '../../infra/locks/lock.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AppError } from '../../common/errors/app-error';
import { StatsQueryService } from '../statistics/stats-query.service';
import { toMetrics } from '../statistics/metrics';
import { ActivityService } from '../activity/activity.service';
import {
  ENTITY_LOCK_TTL_MS,
  EntityActionsService,
  entityLockName,
  mayHaveBeenApplied,
} from './entity-actions.service';
import { Prisma } from '../../generated/prisma/client';

export const campaignListQuerySchema = paginationQuerySchema.extend({
  adAccountId: z.uuid().optional(),
  status: z.string().max(40).optional(),
  templateId: z.uuid().optional(),
  country: z.string().length(2).optional(),
  range: z.enum(DATE_RANGE_KEYS).default('today'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const budgetChangeSchema = z.object({
  level: z.enum(['CAMPAIGN', 'ADSET']),
  id: z.uuid(),
  mode: z.enum(['SET', 'INCREASE_PCT', 'DECREASE_PCT']),
  /** Major units for SET, percent for INCREASE/DECREASE. */
  value: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,4})?$/),
  /** Changes above 50 % require explicit confirmation (UI shows a confirmation dialog). */
  confirmLargeChange: z.boolean().default(false),
});

const METRIC_SORT = new Set(['spend', 'leads', 'cpl', 'ctr', 'cpc', 'impressions', 'purchases', 'results']);

/** How long the outcome of a budget change is kept for requests repeated with the same Idempotency-Key. */
const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

interface BudgetChangeResult {
  field: 'daily_budget' | 'lifetime_budget';
  before: string | null;
  after: string | null;
  currency: string;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsQueryService,
    private readonly actions: EntityActionsService,
    private readonly activity: ActivityService,
    private readonly locks: LockService,
    private readonly redis: RedisService,
  ) {}

  async list(userId: string, q: z.infer<typeof campaignListQuerySchema>) {
    const where: Prisma.CampaignWhereInput = {
      userId,
      isDeleted: false,
      adAccount: { isConnected: true },
      ...(q.adAccountId ? { adAccountId: q.adAccountId } : {}),
      ...(q.status ? { effectiveStatus: q.status } : {}),
      ...(q.templateId ? { templateId: q.templateId } : {}),
      ...(q.country ? { countries: { has: q.country.toUpperCase() } } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { metaCampaignId: q.q.trim() }] }
        : {}),
    };
    const campaigns = await this.prisma.campaign.findMany({
      where,
      include: {
        adAccount: {
          select: { id: true, name: true, currency: true, timezoneName: true, metaAccountId: true },
        },
      },
      take: 5000,
    });
    const accounts = [
      ...new Map(
        campaigns.map((c) => [
          c.adAccount.id,
          { id: c.adAccount.id, timezoneName: c.adAccount.timezoneName, currency: c.adAccount.currency },
        ]),
      ).values(),
    ];
    const metrics = await this.stats.byObject(accounts, q.range, 'CAMPAIGN', {
      custom: { from: q.from, to: q.to },
      metaObjectIds: campaigns.map((c) => c.metaCampaignId),
    });
    let rows = campaigns.map((c) => {
      const agg = metrics.get(c.metaCampaignId);
      const m: MetricsDto | null = agg ? toMetrics(agg.counters, c.adAccount.currency) : null;
      return {
        id: c.id,
        metaCampaignId: c.metaCampaignId,
        name: c.name,
        objective: c.objective,
        status: c.status,
        effectiveStatus: c.effectiveStatus,
        adAccount: { id: c.adAccount.id, name: c.adAccount.name, metaAccountId: c.adAccount.metaAccountId },
        currency: c.adAccount.currency,
        budget: c.dailyBudget
          ? { type: 'DAILY', amount: minorToMajor(c.dailyBudget, c.adAccount.currency) }
          : c.lifetimeBudget
            ? { type: 'LIFETIME', amount: minorToMajor(c.lifetimeBudget, c.adAccount.currency) }
            : null,
        countries: c.countries,
        templateId: c.templateId,
        metrics: m,
        updatedAt: c.metaUpdatedTime ?? c.updatedAt,
      };
    });
    const [field, dir] = (q.sort ?? 'updatedAt:desc').split(':') as [string, 'asc' | 'desc'];
    rows.sort((a, b) => {
      let cmp = 0;
      if (METRIC_SORT.has(field)) {
        const av = a.metrics?.[field as keyof MetricsDto] ?? null;
        const bv = b.metrics?.[field as keyof MetricsDto] ?? null;
        cmp =
          av === null ? (bv === null ? 0 : -1) : bv === null ? 1 : new Decimal(String(av)).cmp(String(bv));
      } else if (field === 'name') cmp = a.name.localeCompare(b.name);
      else cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return dir === 'asc' ? cmp : -cmp;
    });
    const total = rows.length;
    rows = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    return { items: rows, total, page: q.page, pageSize: q.pageSize };
  }

  async detail(
    userId: string,
    id: string,
    range: (typeof DATE_RANGE_KEYS)[number],
    custom?: { from?: string; to?: string },
  ) {
    const c = await this.prisma.campaign.findFirst({
      where: { id, userId },
      include: {
        adAccount: {
          select: { id: true, name: true, currency: true, timezoneName: true, metaAccountId: true },
        },
        adSets: { where: { isDeleted: false }, orderBy: { name: 'asc' } },
        ads: { where: { isDeleted: false }, orderBy: { name: 'asc' } },
      },
    });
    if (!c) throw AppError.notFound('Campaign');
    const acc = [
      { id: c.adAccount.id, timezoneName: c.adAccount.timezoneName, currency: c.adAccount.currency },
    ];
    const [cm, sm, am] = await Promise.all([
      this.stats.byObject(acc, range, 'CAMPAIGN', { custom, metaObjectIds: [c.metaCampaignId] }),
      this.stats.byObject(acc, range, 'ADSET', { custom, metaCampaignId: c.metaCampaignId }),
      this.stats.byObject(acc, range, 'AD', { custom, metaCampaignId: c.metaCampaignId }),
    ]);
    const cur = c.adAccount.currency;
    const m = (map: typeof cm, key: string) => {
      const agg = map.get(key);
      return agg ? toMetrics(agg.counters, cur) : null;
    };
    const timeline = await this.activity.list(userId, {
      entityMetaIds: [
        c.metaCampaignId,
        ...c.adSets.map((s) => s.metaAdSetId),
        ...c.ads.map((a) => a.metaAdId),
      ],
      page: 1,
      pageSize: 50,
    });
    const budget = (daily: bigint | null, lifetime: bigint | null) =>
      daily
        ? { type: 'DAILY', amount: minorToMajor(daily, cur) }
        : lifetime
          ? { type: 'LIFETIME', amount: minorToMajor(lifetime, cur) }
          : null;
    return {
      id: c.id,
      metaCampaignId: c.metaCampaignId,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      bidStrategy: c.bidStrategy,
      budget: budget(c.dailyBudget, c.lifetimeBudget),
      currency: cur,
      adAccount: c.adAccount,
      countries: c.countries,
      specialAdCategories: c.specialAdCategories,
      launchJobId: c.launchJobId,
      templateId: c.templateId,
      issuesInfo: c.issuesInfo,
      metrics: m(cm, c.metaCampaignId),
      adSets: c.adSets.map((s) => ({
        id: s.id,
        metaAdSetId: s.metaAdSetId,
        name: s.name,
        status: s.status,
        effectiveStatus: s.effectiveStatus,
        optimizationGoal: s.optimizationGoal,
        budget: budget(s.dailyBudget, s.lifetimeBudget),
        countries: s.countries,
        metrics: m(sm, s.metaAdSetId),
      })),
      ads: c.ads.map((a) => ({
        id: a.id,
        metaAdId: a.metaAdId,
        adSetId: a.adSetId,
        name: a.name,
        status: a.status,
        effectiveStatus: a.effectiveStatus,
        reviewFeedback: a.reviewFeedback,
        issuesInfo: a.issuesInfo,
        metrics: m(am, a.metaAdId),
      })),
      timeline: timeline.items,
      lastSyncedAt: c.lastSyncedAt,
    };
  }

  /**
   * Manual budget change. With an `Idempotency-Key` header, a repeated request (a retry after a timeout, a
   * double submit) returns the first outcome instead of applying a relative change ("+20 %") a second time.
   * A request that changed nothing (invalid value, large change not yet confirmed) does not use up its key.
   */
  async changeBudget(
    userId: string,
    input: z.infer<typeof budgetChangeSchema>,
    idempotencyKey?: string,
  ): Promise<BudgetChangeResult> {
    if (idempotencyKey === undefined) return this.applyBudgetChange(userId, input);
    const parsed = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsed.success)
      throw AppError.validation('Invalid Idempotency-Key header', [
        { path: 'Idempotency-Key', message: 'Use 8–100 letters, digits, "-" or "_"' },
      ]);
    const key = this.redis.key('idempotency', 'budget', userId, parsed.data);
    const request = JSON.stringify([input.level, input.id, input.mode, input.value]);
    if (
      (await this.redis.client.set(key, JSON.stringify({ request }), 'PX', IDEMPOTENCY_TTL_MS, 'NX')) !== 'OK'
    ) {
      const stored = JSON.parse((await this.redis.client.get(key)) ?? '{}') as {
        request?: string;
        response?: BudgetChangeResult;
      };
      if (stored.request !== undefined && stored.request !== request) {
        throw new AppError(
          'BAD_REQUEST',
          'This Idempotency-Key was already used for a different budget change',
          undefined,
          { status: 422 },
        );
      }
      if (stored.response) return stored.response;
      throw AppError.conflict(
        'This budget change is still being applied, or its result is unknown. Reload the budget before changing it again.',
      );
    }
    const progress = { sending: false };
    try {
      const response = await this.applyBudgetChange(userId, input, progress);
      await this.redis.client
        .set(key, JSON.stringify({ request, response }), 'PX', IDEMPOTENCY_TTL_MS)
        .catch(() => undefined);
      return response;
    } catch (err) {
      // Nothing was changed: the key can be used again. Otherwise it stays taken, so that a retry can never
      // apply the change twice.
      if (!progress.sending || !mayHaveBeenApplied(err))
        await this.redis.client.del(key).catch(() => undefined);
      throw err;
    }
  }

  /** `progress.sending` is set once the new budget goes to Meta: only a failure from then on can hide a change. */
  private async applyBudgetChange(
    userId: string,
    input: z.infer<typeof budgetChangeSchema>,
    progress = { sending: false },
  ): Promise<BudgetChangeResult> {
    const resolved = await this.actions.resolve(userId, input.level, input.id);
    // Under the lock automated rules take: the change is computed from the live budget and applied with no
    // other change to the object (a rule, another tab) in between.
    const locked = await this.locks.withLock(
      entityLockName(resolved.metaId),
      ENTITY_LOCK_TTL_MS,
      async () => {
        // Relative changes and the large-change check start from the real current budget in Meta.
        const e = await this.actions.refresh(resolved);
        const current =
          e.dailyBudget && e.dailyBudget > 0n
            ? e.dailyBudget
            : e.lifetimeBudget && e.lifetimeBudget > 0n
              ? e.lifetimeBudget
              : null;
        if (current === null) {
          throw AppError.validation(
            e.level === 'CAMPAIGN'
              ? 'This campaign uses ad set budgets'
              : 'This ad set uses the campaign budget',
          );
        }
        let next: bigint;
        try {
          next =
            input.mode === 'SET'
              ? majorToMinor(input.value, e.currency)
              : applyPercent(current, input.mode === 'INCREASE_PCT' ? input.value : `-${input.value}`);
        } catch (err) {
          // More decimals than the currency has (e.g. any for JPY), or a percentage out of range.
          throw AppError.validation((err as Error).message, [
            { path: 'value', message: (err as Error).message },
          ]);
        }
        const changePct = current > 0n ? Number(((next - current) * 10000n) / current) / 100 : 100;
        if (Math.abs(changePct) > 50 && !input.confirmLargeChange) {
          throw AppError.conflict(
            `This changes the budget by ${changePct.toFixed(1)} %. Confirm the large change to continue.`,
            {
              requiresConfirmation: true,
              before: minorToMajor(current, e.currency),
              after: minorToMajor(next, e.currency),
              currency: e.currency,
              changePct,
            },
          );
        }
        progress.sending = true;
        const res = await this.actions.setBudget(
          e,
          next,
          { source: 'USER', actorUserId: userId },
          { fresh: true },
        );
        return {
          field: res.field,
          before: minorToMajor(res.before, e.currency),
          after: minorToMajor(res.after, e.currency),
          currency: e.currency,
        };
      },
    );
    if (!locked.acquired)
      throw AppError.conflict(
        'Another change to this object is in progress (for example an automated rule). Try again in a moment.',
      );
    return locked.result;
  }
}
