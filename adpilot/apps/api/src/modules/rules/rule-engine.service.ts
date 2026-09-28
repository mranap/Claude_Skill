import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  RULE_METRICS_DAILY_ONLY,
  RULE_METRIC_LABELS,
  RULE_OPERATOR_LABELS,
  applyPercent,
  majorToMinor,
  minorToMajor,
  type RuleCondition,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LockService } from '../../infra/locks/lock.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../infra/logger/logger';
import { MetaConnectionFactory } from '../meta/meta-connection.factory';
import { MetaGraphClient } from '../meta/graph/meta-graph.client';
import { isBudgetChangeLimit, MetaApiError } from '../meta/graph/meta-errors';
import { AppError } from '../../common/errors/app-error';
import { ENTITY_LOCK_TTL_MS, EntityActionsService, EntityRef, entityLockName, mayHaveBeenApplied } from '../campaigns/entity-actions.service';
import { MetricValues, RuleMetricsService } from './rule-metrics.service';
import { Prisma, type AutoRule, type RuleExecutionResult } from '../../generated/prisma/client';

const LEASE_MS = 10 * 60_000;
/** A running evaluation renews its lease this often, so only the lease of a crashed worker runs out. */
const LEASE_RENEW_MS = 2 * 60_000;

interface Candidate {
  id: string;
  metaId: string;
  name: string;
  adAccountId: string;
  effectiveStatus: string | null;
  status: string | null;
}

export interface RuleRunSummary {
  runId: string;
  evaluated: number;
  matched: number;
  acted: number;
  skipped: number;
  failed: number;
  dryRun: number;
  deferredMs?: number;
}

/** UNCONFIRMED: Meta may have applied the change (no answer); the execution row stays PENDING until verified. */
type ActOutcome = { result: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'DRY_RUN' | 'NOTIFIED' | 'UNCONFIRMED'; text: string; rateLimitedMs?: number };
type RecordExecution = (
  data: Partial<Prisma.AutoRuleExecutionUncheckedCreateInput> & { result: Prisma.AutoRuleExecutionUncheckedCreateInput['result'] },
) => Promise<{ id: string }>;

export function evaluateCondition(c: RuleCondition, values: MetricValues): { ok: boolean; actual: string | null } {
  const actual = values[c.metric];
  if (actual === null || actual === undefined) return { ok: false, actual: null };
  const a = new Decimal(actual);
  const v = new Decimal(c.value);
  switch (c.operator) {
    case 'gt':
      return { ok: a.gt(v), actual };
    case 'gte':
      return { ok: a.gte(v), actual };
    case 'lt':
      return { ok: a.lt(v), actual };
    case 'lte':
      return { ok: a.lte(v), actual };
    case 'eq':
      return { ok: a.eq(v), actual };
    case 'between':
      return { ok: a.gte(v) && a.lte(new Decimal(c.valueTo ?? c.value)), actual };
  }
}

export function describeCondition(c: RuleCondition, currency: string | null): string {
  const meta = RULE_METRIC_LABELS[c.metric];
  const unit = meta.money && currency ? ` ${currency}` : '';
  return c.operator === 'between'
    ? `${meta.label} between ${c.value} and ${c.valueTo}${unit}`
    : `${meta.label} ${RULE_OPERATOR_LABELS[c.operator]} ${c.value}${unit}`;
}

export interface BudgetBounds {
  /** Maximum change per execution, in percent. */
  maxChangePercent: string | null;
  /** Rule minimum and maximum, and the ad account's minimum daily budget (daily budgets only), in minor units. */
  min: bigint | null;
  max: bigint | null;
  accountMin: bigint | null;
}

/**
 * The new budget of a budget rule, in minor units. The maximum and the minimums are applied first and the
 * maximum change per execution last, so no bound can make a bigger change than that. A bound never turns the
 * action around: an increase capped by a maximum below the current budget, or a decrease lifted by a minimum
 * above it, is skipped instead of moving the budget the other way.
 */
export function planBudgetChange(
  action: 'INCREASE_BUDGET' | 'DECREASE_BUDGET' | 'SET_BUDGET',
  current: bigint,
  value: string,
  bounds: BudgetBounds,
  currency: string,
): { next: bigint; note: string | null } | { skip: string } {
  const target = action === 'SET_BUDGET' ? majorToMinor(value, currency) : applyPercent(current, action === 'INCREASE_BUDGET' ? value : `-${value}`);
  const up = target > current;
  const fmt = (v: bigint) => `${minorToMajor(v, currency)} ${currency}`;
  let next = target;
  let note: string | null = null;
  if (bounds.max !== null && next > bounds.max) {
    next = bounds.max;
    note = `capped at maximum ${fmt(bounds.max)}`;
  }
  const floor = [bounds.min ?? 0n, bounds.accountMin ?? 0n].reduce((a, b) => (a > b ? a : b));
  if (next < floor) {
    next = floor;
    note = `kept at minimum ${fmt(floor)}`;
  }
  if (bounds.maxChangePercent) {
    const upper = applyPercent(current, bounds.maxChangePercent);
    const lower = applyPercent(current, `-${bounds.maxChangePercent}`);
    if (next > upper) {
      next = upper;
      note = `limited to +${bounds.maxChangePercent} % per execution`;
    } else if (next < lower) {
      next = lower;
      note = `limited to −${bounds.maxChangePercent} % per execution`;
    }
  }
  if (next === current || up !== next > current) {
    const bound = up ? bounds.max : floor;
    return bound !== null && (up ? bound <= current : bound >= current)
      ? { skip: `Budget ${fmt(current)} is already at or ${up ? 'above the maximum' : 'below the minimum'} ${fmt(bound)}` }
      : { skip: `Budget already at the limit (${fmt(current)})` };
  }
  return { next, note };
}

const errorText = (err: unknown) => (err instanceof MetaApiError ? err.details.friendlyMessage : err instanceof Error ? err.message : String(err));

/**
 * Automated rules. One evaluation run:
 *  1. takes a database lease on the rule with a token of its own, renews it while running and checks it before
 *     every action (a rule is never evaluated by two workers at once, and a run that lost its lease stops);
 *  2. loads the matching entities and fetches fresh Insights for the configured time range;
 *  3. evaluates all conditions (AND) per entity;
 *  4. applies safeguards: cooldown, max actions per day, no repeated identical action, budget min/max and
 *     max change per execution, account minimum budget; dry-run records what would happen (with the same limits);
 *  5. writes a PENDING execution row *before* calling Meta and finalises it afterwards, so a crash can never
 *     lead to the same budget change being applied twice (a PENDING row blocks the entity until verified; so
 *     does a call whose answer was lost);
 *  6. sends one summary notification per run, also when an ad account or the run failed part-way.
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new AppLogger('RuleEngine');
  private readonly workerId = `${hostname()}:${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly connections: MetaConnectionFactory,
    private readonly graph: MetaGraphClient,
    private readonly metrics: RuleMetricsService,
    private readonly actions: EntityActionsService,
  ) {}

  async run(ruleId: string, opts: { manual?: boolean } = {}): Promise<RuleRunSummary | { skipped: string }> {
    const now = new Date();
    // One token per run, not per process: a run renews and releases only its own lease, also when a second
    // run of the rule started in the same worker after the first one's lease had expired.
    const lease = { token: `${this.workerId}:${randomUUID()}`, lost: false };
    const leased = await this.prisma.autoRule.updateMany({
      where: {
        id: ruleId,
        deletedAt: null,
        ...(opts.manual ? {} : { isActive: true }),
        OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: { leaseOwner: lease.token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (leased.count !== 1) return { skipped: 'rule is inactive or already being evaluated' };
    const heartbeat = setInterval(() => {
      void this.renewLease(ruleId, lease.token).then(
        (held) => (lease.lost ||= !held),
        () => undefined,
      );
    }, LEASE_RENEW_MS);
    try {
      const rule = await this.prisma.autoRule.findUniqueOrThrow({ where: { id: ruleId } });
      return await this.evaluate(rule, opts, lease);
    } finally {
      clearInterval(heartbeat);
      await this.prisma.autoRule.updateMany({ where: { id: ruleId, leaseOwner: lease.token }, data: { leaseOwner: null, leaseExpiresAt: null } });
    }
  }

  /** Extends this run's lease; false when another run holds it now (this one's had expired). */
  private async renewLease(ruleId: string, token: string): Promise<boolean> {
    const renewed = await this.prisma.autoRule.updateMany({ where: { id: ruleId, leaseOwner: token }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
    return renewed.count === 1;
  }

  private async evaluate(rule: AutoRule, opts: { manual?: boolean }, lease: { token: string; lost: boolean }): Promise<RuleRunSummary> {
    const runId = randomUUID();
    const summary: RuleRunSummary = { runId, evaluated: 0, matched: 0, acted: 0, skipped: 0, failed: 0, dryRun: 0 };
    const actionsTaken: string[] = [];
    const accountErrors: { name: string; err: unknown }[] = [];
    let accountsEvaluated = 0;
    let runError: unknown;
    let ruleError: string | null = null;
    try {
      const scope = rule.scope as { adAccountIds: string[]; campaignIds?: string[]; nameContains?: string };
      const conditions = rule.conditions as unknown as RuleCondition[];
      // A rule saved before "Last N hours" rejected conversion metrics can never match (they are not evaluated
      // for that range): it reports why instead of running.
      const unavailable = rule.timeRange === 'LAST_N_HOURS' ? conditions.find((c) => RULE_METRICS_DAILY_ONLY.includes(c.metric)) : undefined;
      if (unavailable) ruleError = `${RULE_METRIC_LABELS[unavailable.metric].label} is not available for "Last N hours" (Meta does not report website conversions by hour); edit the rule`;
      const accounts = ruleError
        ? []
        : await this.prisma.adAccount.findMany({
            where: { id: { in: scope.adAccountIds }, userId: rule.userId, isConnected: true },
            include: { profile: { include: { proxy: true } } },
          });
      const { maxEntitiesPerEvaluation } = await this.settings.get('rules');
      accounts: for (const account of accounts) {
        if (account.profile.deletedAt || account.profile.status !== 'ACTIVE' || !account.profile.isEnabled) continue;
        const candidates = (await this.candidates(rule, account.id, scope)).slice(0, maxEntitiesPerEvaluation);
        if (!candidates.length) continue;
        let values: Map<string, MetricValues>;
        try {
          const conn = await this.connections.forProfile(account.profile);
          values = await this.metrics.fetch(account, conn, rule.targetLevel as 'CAMPAIGN' | 'ADSET' | 'AD', candidates.map((c) => c.metaId), rule.timeRange, rule.timeRangeValue ?? undefined);
        } catch (err) {
          if (err instanceof MetaApiError && err.category === 'RATE_LIMIT') {
            summary.deferredMs = err.details.retryAfterMs ?? 60_000;
            break;
          }
          // One ad account must not stop the others, nor hide the actions already taken on them.
          this.logger.warn('Rule metrics failed for an ad account', { ruleId: rule.id, adAccountId: account.id, err: String(err) });
          accountErrors.push({ name: account.name, err });
          continue;
        }
        accountsEvaluated++;
        for (const c of candidates) {
          summary.evaluated++;
          const v = values.get(c.metaId)!;
          const results = conditions.map((cond) => ({ cond, ...evaluateCondition(cond, v) }));
          if (!results.every((r) => r.ok)) continue;
          summary.matched++;
          // Fencing: a run whose lease expired and was taken over stops before acting again.
          if (lease.lost || !(await this.renewLease(rule.id, lease.token))) {
            lease.lost = true;
            this.logger.warn('Rule run lost its lease, stopping', { ruleId: rule.id, runId });
            break accounts;
          }
          const conditionData = {
            timeRange: rule.timeRange,
            timeRangeValue: rule.timeRangeValue,
            metrics: v,
            conditions: results.map((r) => ({ text: describeCondition(r.cond, account.currency), actual: r.actual })),
          };
          let outcome: ActOutcome;
          try {
            outcome = await this.act(rule, runId, account.id, account.currency, account.minDailyBudget, c, conditionData);
          } catch (err) {
            // One object must not stop the whole run: a throttled call defers the rest of the run, a deleted
            // object is skipped, anything else is counted as failed for this object.
            const meta = (err as { meta?: { category?: string; retryAfterMs?: number; code?: number; subcode?: number } }).meta;
            const details = meta ?? (err instanceof MetaApiError ? err.details : undefined);
            if (details && isBudgetChangeLimit(details)) {
              // Meta blocks budget changes of this one ad set for an hour: skip it, the others are not affected.
              summary.skipped++;
              continue;
            }
            if (meta?.category === 'RATE_LIMIT' || (err instanceof MetaApiError && err.category === 'RATE_LIMIT')) {
              summary.deferredMs = meta?.retryAfterMs ?? (err instanceof MetaApiError ? err.details.retryAfterMs : undefined) ?? 60_000;
              break;
            }
            this.logger.warn('Rule action failed', { ruleId: rule.id, entity: c.metaId, err: String(err) });
            if (err instanceof AppError && err.code === 'NOT_FOUND') summary.skipped++;
            else summary.failed++;
            continue;
          }
          if (outcome.result === 'SUCCESS' || outcome.result === 'NOTIFIED') {
            summary.acted++;
            actionsTaken.push(outcome.text);
          } else if (outcome.result === 'DRY_RUN') {
            summary.dryRun++;
            actionsTaken.push(`[dry run] ${outcome.text}`);
          } else if (outcome.result === 'UNCONFIRMED') {
            // Possibly applied, so it is reported now; Meta is checked before the next action on the object.
            summary.failed++;
            actionsTaken.push(outcome.text);
          } else if (outcome.result === 'FAILED') summary.failed++;
          else summary.skipped++;
          if (outcome.rateLimitedMs) {
            summary.deferredMs = outcome.rateLimitedMs;
            break;
          }
        }
        if (summary.deferredMs) break;
      }
    } catch (err) {
      this.logger.error('Rule evaluation failed', { ruleId: rule.id, err });
      runError = err;
    }

    const errors = [...(ruleError ? [ruleError] : []), ...(runError === undefined ? [] : [errorText(runError)]), ...accountErrors.map((a) => `${a.name}: ${errorText(a.err)}`)];
    const failedEntirely = ruleError !== null || runError !== undefined || (accountErrors.length > 0 && accountsEvaluated === 0);
    try {
      // Written only while this run still holds the lease: a run that was taken over leaves the rule to its successor.
      await this.prisma.autoRule.updateMany({
        where: { id: rule.id, leaseOwner: lease.token },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: failedEntirely ? 'ERROR' : errors.length || summary.failed ? 'PARTIAL' : 'OK',
          lastRunError: errors.length ? errors.join('; ').slice(0, 500) : null,
          ...(opts.manual ? {} : { nextRunAt: new Date(Date.now() + (summary.deferredMs ?? rule.checkIntervalMinutes * 60_000)) }),
        },
      });
    } finally {
      if (rule.notify && actionsTaken.length) {
        await this.notifications.notify({
          userId: rule.userId,
          type: 'AUTO_RULE_TRIGGERED',
          severity: summary.failed || errors.length ? 'WARNING' : 'INFO',
          title: `Rule "${rule.name}" ${rule.isDryRun ? '(dry run) ' : ''}acted on ${actionsTaken.length} object(s)`,
          body: actionsTaken.slice(0, 15).join('\n') + (actionsTaken.length > 15 ? `\n… and ${actionsTaken.length - 15} more` : ''),
          link: `/rules/${rule.id}`,
          dedupeKey: `rule-run:${runId}`,
        });
      }
    }
    // A failure still fails the job, so it is retried with back-off (objects acted on are in their cooldown).
    const failure = runError ?? accountErrors[0]?.err;
    if (failure !== undefined) throw failure instanceof Error ? failure : new Error(errorText(failure));
    return summary;
  }

  private async candidates(rule: AutoRule, adAccountId: string, scope: { campaignIds?: string[]; nameContains?: string }): Promise<Candidate[]> {
    const nameFilter = scope.nameContains ? { name: { contains: scope.nameContains, mode: 'insensitive' as const } } : {};
    const campaignFilter = scope.campaignIds?.length ? scope.campaignIds : undefined;
    // START acts on paused objects; everything else on delivering (active) ones.
    const statuses = rule.action === 'START' ? ['PAUSED'] : ['ACTIVE'];
    const statusWhere = rule.action === 'START' ? { status: { in: statuses } } : { status: 'ACTIVE' };
    if (rule.targetLevel === 'CAMPAIGN') {
      const rows = await this.prisma.campaign.findMany({
        where: { userId: rule.userId, adAccountId, isDeleted: false, ...statusWhere, ...nameFilter, ...(campaignFilter ? { id: { in: campaignFilter } } : {}) },
        select: { id: true, metaCampaignId: true, name: true, adAccountId: true, effectiveStatus: true, status: true },
      });
      return rows.map((r) => ({ id: r.id, metaId: r.metaCampaignId, name: r.name, adAccountId: r.adAccountId, effectiveStatus: r.effectiveStatus, status: r.status }));
    }
    if (rule.targetLevel === 'ADSET') {
      const rows = await this.prisma.adSet.findMany({
        where: { userId: rule.userId, adAccountId, isDeleted: false, ...statusWhere, ...nameFilter, ...(campaignFilter ? { campaignId: { in: campaignFilter } } : {}) },
        select: { id: true, metaAdSetId: true, name: true, adAccountId: true, effectiveStatus: true, status: true },
      });
      return rows.map((r) => ({ id: r.id, metaId: r.metaAdSetId, name: r.name, adAccountId: r.adAccountId, effectiveStatus: r.effectiveStatus, status: r.status }));
    }
    const rows = await this.prisma.ad.findMany({
      where: { userId: rule.userId, adAccountId, isDeleted: false, ...statusWhere, ...nameFilter, ...(campaignFilter ? { campaignId: { in: campaignFilter } } : {}) },
      select: { id: true, metaAdId: true, name: true, adAccountId: true, effectiveStatus: true, status: true },
    });
    return rows.map((r) => ({ id: r.id, metaId: r.metaAdId, name: r.name, adAccountId: r.adAccountId, effectiveStatus: r.effectiveStatus, status: r.status }));
  }

  private async act(
    rule: AutoRule,
    runId: string,
    adAccountId: string,
    currency: string,
    accountMinDaily: bigint | null,
    c: Candidate,
    conditionData: Record<string, unknown>,
  ): Promise<ActOutcome> {
    const record: RecordExecution = (data) =>
      this.prisma.autoRuleExecution.create({
        data: {
          ruleId: rule.id,
          userId: rule.userId,
          runId,
          adAccountId,
          entityLevel: rule.targetLevel,
          entityMetaId: c.metaId,
          entityName: c.name,
          action: rule.action,
          conditionData: conditionData as Prisma.InputJsonValue,
          isDryRun: rule.isDryRun,
          ...data,
        },
      });

    if (rule.action === 'NOTIFY_ONLY') {
      const limited = await this.checkLimits(rule, c, record);
      if (limited) return limited;
      await record({ result: 'NOTIFIED', reason: 'Conditions met' });
      return { result: 'NOTIFIED', text: `"${c.name}": conditions met` };
    }

    // Changes in Meta are decided under the object's lock (manual budget changes take it too): the limits are
    // checked and the change applied with no other action in between, so two actions can never both pass the
    // cooldown. The lock is renewed while the action runs.
    const locked = await this.locks.withLock(entityLockName(c.metaId), ENTITY_LOCK_TTL_MS, async (): Promise<ActOutcome> => {
      const limited = await this.checkLimits(rule, c, record);
      if (limited) return limited;
      // Decisions (already paused? current budget?) are made on the live state in Meta, not the local mirror.
      const entity = await this.actions.refresh(await this.actions.resolve(rule.userId, rule.targetLevel as 'CAMPAIGN' | 'ADSET' | 'AD', c.id));
      if (rule.action === 'PAUSE' || rule.action === 'START') {
        const target = rule.action === 'PAUSE' ? 'PAUSED' : 'ACTIVE';
        if (entity.status === target) return this.skip(rule, c, `Already ${target.toLowerCase()}`, record);
        const text = `${rule.action === 'PAUSE' ? 'Paused' : 'Started'} "${c.name}"`;
        if (rule.isDryRun) {
          await record({ result: 'DRY_RUN', oldValue: entity.status, newValue: target, reason: 'Dry run — no change sent to Meta' });
          return { result: 'DRY_RUN', text };
        }
        const pending = await record({ result: 'PENDING', oldValue: entity.status, newValue: target });
        return this.finishAction(pending.id, text, () => this.actions.setStatus(entity, target, { source: 'RULE', ruleId: rule.id, ruleName: rule.name }, { fresh: true }).then(() => undefined));
      }
      return this.budgetAction(rule, entity, currency, accountMinDaily, c, record);
    });
    return locked.acquired ? locked.result : this.skip(rule, c, 'Another action on this object is in progress', record);
  }

  /**
   * Safeguards shared by all actions: cooldown and maximum actions per 24 h for the object. Interrupted or
   * unconfirmed earlier actions are verified against Meta first (whatever their age), so the limits are based
   * on what really happened. A dry run counts its own DRY_RUN rows, so it previews what the live rule would do.
   */
  private async checkLimits(rule: AutoRule, c: Candidate, record: RecordExecution): Promise<ActOutcome | null> {
    const stale = await this.prisma.autoRuleExecution.findMany({ where: { ruleId: rule.id, entityMetaId: c.metaId, result: 'PENDING' }, select: { id: true } });
    for (const p of stale) await this.resolvePending(p.id);
    const counted: RuleExecutionResult[] = rule.isDryRun ? ['SUCCESS', 'PENDING', 'NOTIFIED', 'DRY_RUN'] : ['SUCCESS', 'PENDING', 'NOTIFIED'];
    const since = new Date(Date.now() - rule.cooldownMinutes * 60_000);
    const recent = await this.prisma.autoRuleExecution.findFirst({
      where: { ruleId: rule.id, entityMetaId: c.metaId, result: { in: counted }, executedAt: { gte: since } },
      orderBy: { executedAt: 'desc' },
    });
    if (recent) {
      return this.skip(rule, c, `Cooldown: last action ${Math.round((Date.now() - recent.executedAt.getTime()) / 60000)} min ago (cooldown ${rule.cooldownMinutes} min)`, record);
    }
    const today = await this.prisma.autoRuleExecution.count({
      where: { ruleId: rule.id, entityMetaId: c.metaId, result: { in: counted }, executedAt: { gte: new Date(Date.now() - 86400_000) } },
    });
    if (today >= rule.maxActionsPerDay) return this.skip(rule, c, `Limit of ${rule.maxActionsPerDay} action(s) per 24 h reached`, record);
    return null;
  }

  private async budgetAction(rule: AutoRule, e: EntityRef, currency: string, accountMinDaily: bigint | null, c: Candidate, record: RecordExecution): Promise<ActOutcome> {
    const current = e.dailyBudget && e.dailyBudget > 0n ? e.dailyBudget : e.lifetimeBudget && e.lifetimeBudget > 0n ? e.lifetimeBudget : null;
    if (current === null) return this.skip(rule, c, e.level === 'CAMPAIGN' ? 'Campaign uses ad set budgets' : 'Ad set uses the campaign budget', record);
    let plan: ReturnType<typeof planBudgetChange>;
    try {
      plan = planBudgetChange(rule.action as 'INCREASE_BUDGET' | 'DECREASE_BUDGET' | 'SET_BUDGET', current, rule.actionValue!.toString(), {
        maxChangePercent: rule.maxBudgetChangePercent?.toString() ?? null,
        min: rule.minBudget ? majorToMinor(rule.minBudget.toString(), currency) : null,
        max: rule.maxBudget ? majorToMinor(rule.maxBudget.toString(), currency) : null,
        accountMin: e.dailyBudget ? accountMinDaily : null,
      }, currency);
    } catch (err) {
      // An amount saved before amounts were checked against the account currency (e.g. decimals for JPY).
      return this.skip(rule, c, `Invalid amount in the rule: ${(err as Error).message}`, record);
    }
    if ('skip' in plan) return this.skip(rule, c, plan.skip, record);
    const { next, note } = plan;
    const text = `"${c.name}" budget ${minorToMajor(current, currency)} → ${minorToMajor(next, currency)} ${currency}${note ? ` (${note})` : ''}`;
    if (rule.isDryRun) {
      await record({ result: 'DRY_RUN', oldValue: current.toString(), newValue: next.toString(), reason: `Dry run${note ? `; ${note}` : ''}` });
      return { result: 'DRY_RUN', text };
    }
    const pending = await record({ result: 'PENDING', oldValue: current.toString(), newValue: next.toString(), reason: note });
    return this.finishAction(pending.id, text, () =>
      this.actions.setBudget(e, next, { source: 'RULE', ruleId: rule.id, ruleName: rule.name }, { fresh: true }).then(() => undefined),
    );
  }

  private async finishAction(executionId: string, text: string, fn: () => Promise<void>): Promise<ActOutcome> {
    try {
      await fn();
      await this.prisma.autoRuleExecution.update({ where: { id: executionId }, data: { result: 'SUCCESS', metaResponse: { success: true } } });
      return { result: 'SUCCESS', text };
    } catch (err) {
      const meta = (err as { meta?: { category?: string; code?: number; subcode?: number; retryAfterMs?: number; message?: string } }).meta;
      const error = {
        errorMessage: (err as Error).message.slice(0, 1000),
        errorCode: meta?.code ?? null,
        metaResponse: meta ? (meta as Prisma.InputJsonValue) : Prisma.DbNull,
      };
      if (mayHaveBeenApplied(err)) {
        // The request may have reached Meta (its answer was lost, or Meta reported an unknown error). The row
        // stays PENDING: the cooldown and the daily limit keep counting it until it is verified in Meta.
        await this.prisma.autoRuleExecution.update({ where: { id: executionId }, data: error });
        return { result: 'UNCONFIRMED', text: `${text} — not confirmed by Meta (${(err as Error).message}); it is checked before the next action` };
      }
      await this.prisma.autoRuleExecution.update({ where: { id: executionId }, data: { result: 'FAILED', ...error } });
      // The per-ad-set budget-change limit only concerns this object: the run goes on with the others.
      const throttled = meta?.category === 'RATE_LIMIT' && !isBudgetChangeLimit(meta);
      return { result: 'FAILED', text: `${text} — failed: ${(err as Error).message}`, rateLimitedMs: throttled ? meta.retryAfterMs ?? 60_000 : undefined };
    }
  }

  /**
   * A PENDING row means a previous run stopped between "intent recorded" and "result recorded", or its call to
   * Meta got no answer. Verify the real value in Meta and finalise the row, so the history is correct and
   * nothing is applied twice.
   */
  private async resolvePending(executionId: string): Promise<void> {
    const ex = await this.prisma.autoRuleExecution.findUniqueOrThrow({ where: { id: executionId }, include: { rule: true } });
    if (Date.now() - ex.executedAt.getTime() < 5 * 60_000) return; // may still be running
    try {
      const account = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: ex.adAccountId! }, include: { profile: { include: { proxy: true } } } });
      const conn = await this.connections.forProfile(account.profile);
      const data = await this.graph.get<{ status?: string; daily_budget?: string; lifetime_budget?: string }>(
        conn,
        `/${ex.entityMetaId}`,
        { fields: 'status,daily_budget,lifetime_budget' },
        'rules.verify_pending',
        { metaAccountId: account.metaAccountId },
      );
      const applied =
        ex.action === 'PAUSE' || ex.action === 'START' ? data.status === ex.newValue : data.daily_budget === ex.newValue || data.lifetime_budget === ex.newValue;
      await this.prisma.autoRuleExecution.update({
        where: { id: executionId },
        data: { result: applied ? 'SUCCESS' : 'FAILED', errorMessage: applied ? null : 'The change was never confirmed, and Meta shows it was not applied' },
      });
    } catch (err) {
      this.logger.warn('Could not verify pending rule execution', { executionId, err: String(err) });
    }
  }

  private async skip(rule: AutoRule, c: Candidate, reason: string, record: RecordExecution): Promise<ActOutcome> {
    // Avoid flooding the history: the same skip reason is recorded at most once per cooldown window.
    const last = await this.prisma.autoRuleExecution.findFirst({
      where: { ruleId: rule.id, entityMetaId: c.metaId },
      orderBy: { executedAt: 'desc' },
      select: { result: true, reason: true, executedAt: true },
    });
    const sameRecent = last?.result === 'SKIPPED' && last.reason?.split(':')[0] === reason.split(':')[0] && Date.now() - last.executedAt.getTime() < rule.cooldownMinutes * 60_000;
    if (!sameRecent) await record({ result: 'SKIPPED', reason });
    return { result: 'SKIPPED', text: `"${c.name}" skipped: ${reason}` };
  }
}
