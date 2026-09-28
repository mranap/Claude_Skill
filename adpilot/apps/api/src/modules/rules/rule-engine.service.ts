import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
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
import { MetaApiError } from '../meta/graph/meta-errors';
import { AppError } from '../../common/errors/app-error';
import { EntityActionsService, EntityRef } from '../campaigns/entity-actions.service';
import { MetricValues, RuleMetricsService } from './rule-metrics.service';
import { Prisma, type AutoRule } from '../../generated/prisma/client';

const LEASE_MS = 10 * 60_000;

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

/**
 * Automated rules. One evaluation run:
 *  1. takes a database lease on the rule (a rule is never evaluated by two workers at once);
 *  2. loads the matching entities and fetches fresh Insights for the configured time range;
 *  3. evaluates all conditions (AND) per entity;
 *  4. applies safeguards: cooldown, max actions per day, no repeated identical action, budget min/max and
 *     max change per execution, account minimum budget; dry-run records what would happen;
 *  5. writes a PENDING execution row *before* calling Meta and finalises it afterwards, so a crash can never
 *     lead to the same budget change being applied twice (a PENDING row blocks the entity until verified);
 *  6. sends one summary notification per run.
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
    const leased = await this.prisma.autoRule.updateMany({
      where: {
        id: ruleId,
        deletedAt: null,
        ...(opts.manual ? {} : { isActive: true }),
        OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: { leaseOwner: this.workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (leased.count !== 1) return { skipped: 'rule is inactive or already being evaluated' };
    const rule = await this.prisma.autoRule.findUniqueOrThrow({ where: { id: ruleId } });
    const runId = randomUUID();
    const summary: RuleRunSummary = { runId, evaluated: 0, matched: 0, acted: 0, skipped: 0, failed: 0, dryRun: 0 };
    const actionsTaken: string[] = [];
    try {
      const scope = rule.scope as { adAccountIds: string[]; campaignIds?: string[]; nameContains?: string };
      const conditions = rule.conditions as unknown as RuleCondition[];
      const accounts = await this.prisma.adAccount.findMany({
        where: { id: { in: scope.adAccountIds }, userId: rule.userId, isConnected: true },
        include: { profile: { include: { proxy: true } } },
      });
      const { maxEntitiesPerEvaluation } = await this.settings.get('rules');
      for (const account of accounts) {
        if (account.profile.deletedAt || account.profile.status !== 'ACTIVE' || !account.profile.isEnabled) continue;
        const candidates = (await this.candidates(rule, account.id, scope)).slice(0, maxEntitiesPerEvaluation);
        if (!candidates.length) continue;
        const conn = await this.connections.forProfile(account.profile);
        let values: Map<string, MetricValues>;
        try {
          values = await this.metrics.fetch(account, conn, rule.targetLevel as 'CAMPAIGN' | 'ADSET' | 'AD', candidates.map((c) => c.metaId), rule.timeRange, rule.timeRangeValue ?? undefined);
        } catch (err) {
          if (err instanceof MetaApiError && err.category === 'RATE_LIMIT') {
            summary.deferredMs = err.details.retryAfterMs ?? 60_000;
            break;
          }
          throw err;
        }
        for (const c of candidates) {
          summary.evaluated++;
          const v = values.get(c.metaId)!;
          const results = conditions.map((cond) => ({ cond, ...evaluateCondition(cond, v) }));
          if (!results.every((r) => r.ok)) continue;
          summary.matched++;
          const conditionData = {
            timeRange: rule.timeRange,
            timeRangeValue: rule.timeRangeValue,
            metrics: v,
            conditions: results.map((r) => ({ text: describeCondition(r.cond, account.currency), actual: r.actual })),
          };
          let outcome: Awaited<ReturnType<RuleEngineService['act']>>;
          try {
            outcome = await this.act(rule, runId, account.id, account.currency, account.minDailyBudget, c, conditionData);
          } catch (err) {
            // One object must not stop the whole run: a throttled call defers the rest of the run, a deleted
            // object is skipped, anything else is counted as failed for this object.
            const meta = (err as { meta?: { category?: string; retryAfterMs?: number } }).meta;
            if (meta?.category === 'RATE_LIMIT' || (err instanceof MetaApiError && err.category === 'RATE_LIMIT')) {
              summary.deferredMs = meta?.retryAfterMs ?? (err instanceof MetaApiError ? err.details.retryAfterMs : undefined) ?? 60_000;
              break;
            }
            this.logger.warn('Rule action failed', { ruleId, entity: c.metaId, err: String(err) });
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
          } else if (outcome.result === 'FAILED') summary.failed++;
          else summary.skipped++;
          if (outcome.rateLimitedMs) {
            summary.deferredMs = outcome.rateLimitedMs;
            break;
          }
        }
        if (summary.deferredMs) break;
      }
      await this.prisma.autoRule.update({
        where: { id: rule.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: summary.failed ? 'PARTIAL' : 'OK',
          lastRunError: null,
          ...(opts.manual ? {} : { nextRunAt: new Date(Date.now() + (summary.deferredMs ?? rule.checkIntervalMinutes * 60_000)) }),
        },
      });
      if (rule.notify && actionsTaken.length) {
        await this.notifications.notify({
          userId: rule.userId,
          type: 'AUTO_RULE_TRIGGERED',
          severity: summary.failed ? 'WARNING' : 'INFO',
          title: `Rule "${rule.name}" ${rule.isDryRun ? '(dry run) ' : ''}acted on ${actionsTaken.length} object(s)`,
          body: actionsTaken.slice(0, 15).join('\n') + (actionsTaken.length > 15 ? `\n… and ${actionsTaken.length - 15} more` : ''),
          link: `/rules/${rule.id}`,
          dedupeKey: `rule-run:${runId}`,
        });
      }
      return summary;
    } catch (err) {
      this.logger.error('Rule evaluation failed', { ruleId, err });
      await this.prisma.autoRule.update({
        where: { id: rule.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'ERROR',
          lastRunError: err instanceof MetaApiError ? err.details.friendlyMessage : (err as Error).message.slice(0, 500),
          ...(opts.manual ? {} : { nextRunAt: new Date(Date.now() + rule.checkIntervalMinutes * 60_000) }),
        },
      });
      throw err;
    } finally {
      await this.prisma.autoRule.updateMany({ where: { id: ruleId, leaseOwner: this.workerId }, data: { leaseOwner: null, leaseExpiresAt: null } });
    }
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
  ): Promise<{ result: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'DRY_RUN' | 'NOTIFIED'; text: string; rateLimitedMs?: number }> {
    const record = (data: Partial<Prisma.AutoRuleExecutionUncheckedCreateInput> & { result: Prisma.AutoRuleExecutionUncheckedCreateInput['result'] }) =>
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

    // ── Safeguards shared by all actions ──
    // Interrupted earlier actions are verified against Meta first (whatever their age), so the history and the
    // limits below are based on what really happened.
    const stale = await this.prisma.autoRuleExecution.findMany({ where: { ruleId: rule.id, entityMetaId: c.metaId, result: 'PENDING' }, select: { id: true } });
    for (const p of stale) await this.resolvePending(p.id);
    const since = new Date(Date.now() - rule.cooldownMinutes * 60_000);
    const recent = await this.prisma.autoRuleExecution.findFirst({
      where: { ruleId: rule.id, entityMetaId: c.metaId, result: { in: ['SUCCESS', 'PENDING', 'NOTIFIED'] }, executedAt: { gte: since } },
      orderBy: { executedAt: 'desc' },
    });
    if (recent) {
      return this.skip(rule, c, `Cooldown: last action ${Math.round((Date.now() - recent.executedAt.getTime()) / 60000)} min ago (cooldown ${rule.cooldownMinutes} min)`, record);
    }
    const today = await this.prisma.autoRuleExecution.count({
      where: { ruleId: rule.id, entityMetaId: c.metaId, result: { in: ['SUCCESS', 'NOTIFIED', 'PENDING'] }, executedAt: { gte: new Date(Date.now() - 86400_000) } },
    });
    if (today >= rule.maxActionsPerDay) return this.skip(rule, c, `Limit of ${rule.maxActionsPerDay} action(s) per 24 h reached`, record);

    if (rule.action === 'NOTIFY_ONLY') {
      await record({ result: 'NOTIFIED', reason: 'Conditions met' });
      return { result: 'NOTIFIED', text: `"${c.name}": conditions met` };
    }

    const lock = await this.locks.acquire(`entity-action:${c.metaId}`, 120_000);
    if (!lock) return this.skip(rule, c, 'Another action on this object is in progress', record);
    try {
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
    } finally {
      await this.locks.release(lock).catch(() => undefined);
    }
  }

  private async budgetAction(
    rule: AutoRule,
    e: EntityRef,
    currency: string,
    accountMinDaily: bigint | null,
    c: Candidate,
    record: (d: Partial<Prisma.AutoRuleExecutionUncheckedCreateInput> & { result: Prisma.AutoRuleExecutionUncheckedCreateInput['result'] }) => Promise<{ id: string }>,
  ) {
    const current = e.dailyBudget && e.dailyBudget > 0n ? e.dailyBudget : e.lifetimeBudget && e.lifetimeBudget > 0n ? e.lifetimeBudget : null;
    if (current === null) return this.skip(rule, c, e.level === 'CAMPAIGN' ? 'Campaign uses ad set budgets' : 'Ad set uses the campaign budget', record);
    const value = rule.actionValue!.toString();
    let next =
      rule.action === 'SET_BUDGET' ? majorToMinor(value, currency) : rule.action === 'INCREASE_BUDGET' ? applyPercent(current, value) : applyPercent(current, `-${value}`);
    const notes: string[] = [];
    if (rule.maxBudgetChangePercent) {
      const maxPct = rule.maxBudgetChangePercent.toString();
      const upper = applyPercent(current, maxPct);
      const lower = applyPercent(current, `-${maxPct}`);
      if (next > upper) {
        next = upper;
        notes.push(`limited to +${maxPct} % per execution`);
      }
      if (next < lower) {
        next = lower;
        notes.push(`limited to −${maxPct} % per execution`);
      }
    }
    if (rule.maxBudget) {
      const max = majorToMinor(rule.maxBudget.toString(), currency);
      if (next > max) {
        next = max;
        notes.push(`capped at maximum ${minorToMajor(max, currency)} ${currency}`);
      }
    }
    const minFromRule = rule.minBudget ? majorToMinor(rule.minBudget.toString(), currency) : 0n;
    const floor = [minFromRule, e.dailyBudget ? accountMinDaily ?? 0n : 0n].reduce((a, b) => (a > b ? a : b), 0n);
    if (next < floor) {
      next = floor;
      notes.push(`kept at minimum ${minorToMajor(floor, currency)} ${currency}`);
    }
    if (next === current) return this.skip(rule, c, `Budget already at the limit (${minorToMajor(current, currency)} ${currency})`, record);
    const text = `"${c.name}" budget ${minorToMajor(current, currency)} → ${minorToMajor(next, currency)} ${currency}${notes.length ? ` (${notes.join(', ')})` : ''}`;
    if (rule.isDryRun) {
      await record({ result: 'DRY_RUN', oldValue: current.toString(), newValue: next.toString(), reason: `Dry run${notes.length ? `; ${notes.join(', ')}` : ''}` });
      return { result: 'DRY_RUN' as const, text };
    }
    const pending = await record({ result: 'PENDING', oldValue: current.toString(), newValue: next.toString(), reason: notes.join(', ') || null });
    return this.finishAction(pending.id, text, () =>
      this.actions.setBudget(e, next, { source: 'RULE', ruleId: rule.id, ruleName: rule.name }, { fresh: true }).then(() => undefined),
    );
  }

  private async finishAction(executionId: string, text: string, fn: () => Promise<void>) {
    try {
      await fn();
      await this.prisma.autoRuleExecution.update({ where: { id: executionId }, data: { result: 'SUCCESS', metaResponse: { success: true } } });
      return { result: 'SUCCESS' as const, text };
    } catch (err) {
      const meta = (err as { meta?: { category?: string; code?: number; retryAfterMs?: number; message?: string } }).meta;
      const rateLimited = meta?.category === 'RATE_LIMIT';
      await this.prisma.autoRuleExecution.update({
        where: { id: executionId },
        data: {
          result: 'FAILED',
          errorMessage: (err as Error).message.slice(0, 1000),
          errorCode: meta?.code ?? null,
          metaResponse: meta ? (meta as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
      return { result: 'FAILED' as const, text: `${text} — failed: ${(err as Error).message}`, rateLimitedMs: rateLimited ? meta?.retryAfterMs ?? 60_000 : undefined };
    }
  }

  /**
   * A PENDING row means a previous run stopped between "intent recorded" and "result recorded". Verify the
   * real value in Meta and finalise the row, so the history is correct and nothing is applied twice.
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
        data: { result: applied ? 'SUCCESS' : 'FAILED', errorMessage: applied ? null : 'The worker stopped before the change was confirmed; Meta shows it was not applied' },
      });
    } catch (err) {
      this.logger.warn('Could not verify pending rule execution', { executionId, err: String(err) });
    }
  }

  private async skip(
    rule: AutoRule,
    c: Candidate,
    reason: string,
    record: (d: Partial<Prisma.AutoRuleExecutionUncheckedCreateInput> & { result: Prisma.AutoRuleExecutionUncheckedCreateInput['result'] }) => Promise<{ id: string }>,
  ) {
    // Avoid flooding the history: the same skip reason is recorded at most once per cooldown window.
    const last = await this.prisma.autoRuleExecution.findFirst({
      where: { ruleId: rule.id, entityMetaId: c.metaId },
      orderBy: { executedAt: 'desc' },
      select: { result: true, reason: true, executedAt: true },
    });
    const sameRecent = last?.result === 'SKIPPED' && last.reason?.split(':')[0] === reason.split(':')[0] && Date.now() - last.executedAt.getTime() < rule.cooldownMinutes * 60_000;
    if (!sameRecent) await record({ result: 'SKIPPED', reason });
    return { result: 'SKIPPED' as const, text: `"${c.name}" skipped: ${reason}` };
  }
}
