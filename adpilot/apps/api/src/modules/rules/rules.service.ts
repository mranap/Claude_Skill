import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  RULE_METRIC_LABELS,
  ruleCreateSchema,
  ruleExecutionsQuerySchema,
  ruleListQuerySchema,
  majorToMinor,
  minorToMajor,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { RedisService } from '../../infra/redis/redis.service';
import { describeCondition } from './rule-engine.service';
import { Prisma, type AutoRule } from '../../generated/prisma/client';

type RuleInput = z.infer<typeof ruleCreateSchema>;

@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  async list(userId: string, q: z.infer<typeof ruleListQuerySchema>) {
    const where: Prisma.AutoRuleWhereInput = {
      userId,
      deletedAt: null,
      ...(q.active ? { isActive: q.active === 'true' } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.autoRule.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.autoRule.count({ where }),
    ]);
    const counts = await this.prisma.autoRuleExecution.groupBy({
      by: ['ruleId', 'result'],
      where: { ruleId: { in: rows.map((r) => r.id) }, executedAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
      _count: { _all: true },
    });
    return {
      items: rows.map((r) => ({
        ...this.toDto(r),
        stats7d: Object.fromEntries(counts.filter((c) => c.ruleId === r.id).map((c) => [c.result, c._count._all])),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async findOwned(userId: string, id: string) {
    const rule = await this.prisma.autoRule.findFirst({ where: { id, userId, deletedAt: null } });
    if (!rule) throw AppError.notFound('Rule');
    return rule;
  }

  async get(userId: string, id: string) {
    return this.toDto(await this.findOwned(userId, id));
  }

  async create(userId: string, input: RuleInput) {
    const { maxRulesPerUser } = await this.settings.get('rules');
    const count = await this.prisma.autoRule.count({ where: { userId, deletedAt: null } });
    if (count >= maxRulesPerUser) throw AppError.validation(`You can have at most ${maxRulesPerUser} rules`);
    const data = await this.prepare(userId, input);
    const rule = await this.prisma.autoRule.create({ data: { ...data, userId, nextRunAt: input.isActive ? new Date(Date.now() + 60_000) : null } });
    await this.audit.log({ action: 'rule.created', actorUserId: userId, subjectUserId: userId, targetType: 'rule', targetId: rule.id, metadata: { name: rule.name, action: rule.action } });
    return this.toDto(rule);
  }

  async update(userId: string, id: string, input: RuleInput) {
    const existing = await this.findOwned(userId, id);
    const data = await this.prepare(userId, input);
    const rule = await this.prisma.autoRule.update({
      where: { id },
      data: { ...data, nextRunAt: input.isActive ? existing.nextRunAt ?? new Date(Date.now() + 60_000) : null },
    });
    await this.audit.log({ action: 'rule.updated', actorUserId: userId, subjectUserId: userId, targetType: 'rule', targetId: id });
    return this.toDto(rule);
  }

  async setActive(userId: string, id: string, isActive: boolean) {
    await this.findOwned(userId, id);
    const rule = await this.prisma.autoRule.update({ where: { id }, data: { isActive, nextRunAt: isActive ? new Date(Date.now() + 60_000) : null } });
    await this.audit.log({ action: isActive ? 'rule.activated' : 'rule.deactivated', actorUserId: userId, subjectUserId: userId, targetType: 'rule', targetId: id });
    return this.toDto(rule);
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.autoRule.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, nextRunAt: null } });
    await this.audit.log({ action: 'rule.deleted', actorUserId: userId, subjectUserId: userId, targetType: 'rule', targetId: id });
  }

  /** "Run now" (respects the same safeguards; cooldowns still apply). At most once per minute per rule. */
  async runNow(userId: string, id: string) {
    await this.findOwned(userId, id);
    const gate = this.redis.key('rules', 'run-now', id);
    if ((await this.redis.client.set(gate, '1', 'PX', 60_000, 'NX')) !== 'OK') {
      const ttl = Math.max(1, Math.ceil((await this.redis.client.pttl(gate)) / 1000));
      throw AppError.cooldown(`This rule was started moments ago. Try again in ${ttl} s.`, ttl);
    }
    const now = Date.now();
    await this.queue.add(QUEUES.AUTO_RULES, JOBS.AUTO_RULE_CHECK, { ruleId: id, userId, slot: `manual-${now}` }, { jobId: jobId('rule', id, 'manual', now), attempts: 3 });
    return { queued: true };
  }

  async executions(userId: string, q: z.infer<typeof ruleExecutionsQuerySchema>) {
    const where: Prisma.AutoRuleExecutionWhereInput = {
      userId,
      ...(q.ruleId ? { ruleId: q.ruleId } : {}),
      ...(q.result ? { result: q.result } : {}),
      ...(q.q ? { OR: [{ entityName: { contains: q.q, mode: 'insensitive' } }, { entityMetaId: q.q }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.autoRuleExecution.findMany({
        where,
        orderBy: { executedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { rule: { select: { name: true, currency: true } } },
      }),
      this.prisma.autoRuleExecution.count({ where }),
    ]);
    return {
      items: rows.map((r) => {
        const currency = r.rule.currency;
        const money = (v: string | null) => (v && /^\d+$/.test(v) && currency && (r.action.endsWith('BUDGET')) ? `${minorToMajor(v, currency)} ${currency}` : v);
        return { ...r, ruleName: r.rule.name, rule: undefined, oldValueDisplay: money(r.oldValue), newValueDisplay: money(r.newValue) };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Validation against the user's data (accounts, currency consistency, intervals). */
  private async prepare(userId: string, input: RuleInput) {
    const { minCheckIntervalMinutes } = await this.settings.get('rules');
    if (input.checkIntervalMinutes < minCheckIntervalMinutes) {
      throw AppError.validation(`Minimum check interval is ${minCheckIntervalMinutes} minutes.`, [{ path: 'checkIntervalMinutes', message: `Minimum ${minCheckIntervalMinutes} minutes` }]);
    }
    const accounts = await this.prisma.adAccount.findMany({ where: { id: { in: input.scope.adAccountIds }, userId }, select: { id: true, currency: true } });
    if (accounts.length !== new Set(input.scope.adAccountIds).size) throw AppError.notFound('Some ad accounts');
    if (input.scope.campaignIds.length) {
      const owned = await this.prisma.campaign.count({ where: { id: { in: input.scope.campaignIds }, userId, adAccountId: { in: input.scope.adAccountIds } } });
      if (owned !== new Set(input.scope.campaignIds).size) throw AppError.validation('Some campaigns do not belong to the selected ad accounts');
    }
    const currencies = [...new Set(accounts.map((a) => a.currency))];
    const usesMoney =
      input.conditions.some((c) => RULE_METRIC_LABELS[c.metric].money) || ['SET_BUDGET'].includes(input.action) || !!input.minBudget || !!input.maxBudget;
    if (usesMoney && currencies.length > 1) {
      throw AppError.validation(`Money amounts are ambiguous across currencies (${currencies.join(', ')}). Select ad accounts with the same currency.`, [
        { path: 'scope.adAccountIds', message: 'Use accounts with one currency' },
      ]);
    }
    // Budget amounts must exist in the account currency (no decimals for JPY, at most 2 for USD), otherwise
    // every run of the rule would fail to convert them.
    const amounts = { actionValue: input.action === 'SET_BUDGET' ? input.actionValue : undefined, minBudget: input.minBudget, maxBudget: input.maxBudget };
    for (const [path, amount] of Object.entries(amounts)) {
      if (amount === undefined) continue;
      try {
        majorToMinor(amount, currencies[0]);
      } catch (err) {
        throw AppError.validation((err as Error).message, [{ path, message: (err as Error).message }]);
      }
    }
    return {
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive,
      isDryRun: input.isDryRun,
      targetLevel: input.targetLevel,
      scope: input.scope as Prisma.InputJsonValue,
      conditions: input.conditions as unknown as Prisma.InputJsonValue,
      timeRange: input.timeRange,
      timeRangeValue: input.timeRangeValue ?? null,
      action: input.action,
      actionValue: input.actionValue ?? null,
      actionValueType: input.action === 'SET_BUDGET' ? 'ABSOLUTE' : input.action.endsWith('_BUDGET') ? 'PERCENT' : null,
      currency: currencies[0] ?? null,
      maxBudgetChangePercent: input.maxBudgetChangePercent ?? null,
      minBudget: input.minBudget ?? null,
      maxBudget: input.maxBudget ?? null,
      cooldownMinutes: input.cooldownMinutes,
      maxActionsPerDay: input.maxActionsPerDay,
      checkIntervalMinutes: input.checkIntervalMinutes,
      notify: input.notify,
    };
  }

  toDto(r: AutoRule) {
    const conditions = r.conditions as unknown as Parameters<typeof describeCondition>[0][];
    return {
      ...r,
      actionValue: r.actionValue?.toString() ?? null,
      maxBudgetChangePercent: r.maxBudgetChangePercent?.toString() ?? null,
      minBudget: r.minBudget?.toString() ?? null,
      maxBudget: r.maxBudget?.toString() ?? null,
      summary: conditions.map((c) => describeCondition(c, r.currency)).join(' AND '),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    };
  }
}
