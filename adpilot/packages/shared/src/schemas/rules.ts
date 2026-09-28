import { z } from 'zod';
import { moneyStringSchema, paginationQuerySchema } from './common';

export const RULE_METRICS = [
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'leads',
  'cpl',
  'purchases',
  'cpa',
  'roas',
  'results',
  'cost_per_result',
] as const;
export type RuleMetric = (typeof RULE_METRICS)[number];

export const RULE_METRIC_LABELS: Record<RuleMetric, { label: string; money: boolean; hint?: string }> = {
  spend: { label: 'Spend', money: true },
  impressions: { label: 'Impressions', money: false },
  clicks: { label: 'Link clicks', money: false },
  ctr: { label: 'CTR (link), %', money: false },
  cpc: { label: 'CPC (link)', money: true },
  cpm: { label: 'CPM', money: true },
  leads: { label: 'Leads', money: false },
  cpl: { label: 'Cost per lead (CPL)', money: true, hint: 'Not evaluated while there are no leads' },
  purchases: { label: 'Purchases', money: false },
  cpa: { label: 'Cost per purchase (CPA)', money: true, hint: 'Not evaluated while there are no purchases' },
  roas: { label: 'Purchase ROAS', money: false },
  results: { label: 'Results', money: false },
  cost_per_result: { label: 'Cost per result', money: true },
};

/**
 * Metrics built from conversions. "Last N hours" needs the hourly Insights breakdown, which is a "Type 1"
 * breakdown for off-Meta action metrics: Insights does not return website (Pixel) leads and purchases with it,
 * so these metrics would read as zero. They are only available for daily time ranges.
 */
export const RULE_METRICS_DAILY_ONLY: readonly RuleMetric[] = ['leads', 'cpl', 'purchases', 'cpa', 'roas', 'results', 'cost_per_result'];

export const RULE_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq', 'between'] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  between: 'between',
};

const decimalString = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, 'Enter a number');
/** A percentage as stored (Decimal(7,2)). */
const percentString = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a percentage like 20 or 12.5');

export const ruleConditionSchema = z
  .object({
    metric: z.enum(RULE_METRICS),
    operator: z.enum(RULE_OPERATORS),
    value: decimalString,
    valueTo: decimalString.optional(),
  })
  .refine((c) => c.operator !== 'between' || (c.valueTo !== undefined && Number(c.valueTo) >= Number(c.value)), {
    message: '"between" needs a second value greater than the first',
    path: ['valueTo'],
  });
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const ruleScopeSchema = z.object({
  adAccountIds: z.array(z.uuid()).min(1, 'Select at least one ad account').max(100),
  /** Restrict to these campaigns (internal ids). Empty = all campaigns of the accounts. */
  campaignIds: z.array(z.uuid()).max(500).default([]),
  nameContains: z.string().trim().max(100).optional(),
});

export const ruleBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
  isDryRun: z.boolean().default(false),
  targetLevel: z.enum(['CAMPAIGN', 'ADSET', 'AD']),
  scope: ruleScopeSchema,
  conditions: z.array(ruleConditionSchema).min(1).max(10),
  timeRange: z.enum(['TODAY', 'YESTERDAY', 'LAST_N_HOURS', 'LAST_N_DAYS']),
  timeRangeValue: z.number().int().min(1).max(90).optional(),
  action: z.enum(['PAUSE', 'START', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'SET_BUDGET', 'NOTIFY_ONLY']),
  /** Percent for INCREASE/DECREASE, amount (major units) for SET. */
  actionValue: decimalString.optional(),
  maxBudgetChangePercent: percentString.optional(),
  minBudget: moneyStringSchema.optional(),
  maxBudget: moneyStringSchema.optional(),
  cooldownMinutes: z.number().int().min(30).max(7 * 24 * 60).default(360),
  maxActionsPerDay: z.number().int().min(1).max(50).default(3),
  checkIntervalMinutes: z.number().int().min(15).max(1440).default(60),
  notify: z.boolean().default(true),
});

function refineRule<T extends z.infer<typeof ruleBaseSchema>>(v: T, ctx: z.RefinementCtx) {
  const budget = v.action === 'INCREASE_BUDGET' || v.action === 'DECREASE_BUDGET' || v.action === 'SET_BUDGET';
  if (budget && v.targetLevel === 'AD') ctx.addIssue({ code: 'custom', path: ['action'], message: 'Ads have no budget; target campaigns or ad sets' });
  if (budget && !v.actionValue) ctx.addIssue({ code: 'custom', path: ['actionValue'], message: v.action === 'SET_BUDGET' ? 'Enter the new budget' : 'Enter the percentage' });
  if ((v.action === 'INCREASE_BUDGET' || v.action === 'DECREASE_BUDGET') && v.actionValue && (Number(v.actionValue) <= 0 || Number(v.actionValue) > (v.action === 'DECREASE_BUDGET' ? 90 : 500))) {
    ctx.addIssue({ code: 'custom', path: ['actionValue'], message: v.action === 'DECREASE_BUDGET' ? 'Use 1–90 %' : 'Use 1–500 %' });
  }
  if ((v.timeRange === 'LAST_N_HOURS' || v.timeRange === 'LAST_N_DAYS') && !v.timeRangeValue) {
    ctx.addIssue({ code: 'custom', path: ['timeRangeValue'], message: 'Enter the number of hours/days' });
  }
  if (v.timeRange === 'LAST_N_HOURS' && v.timeRangeValue && v.timeRangeValue > 48) ctx.addIssue({ code: 'custom', path: ['timeRangeValue'], message: 'Up to 48 hours' });
  if (v.timeRange === 'LAST_N_HOURS') {
    v.conditions.forEach((c, i) => {
      if (!RULE_METRICS_DAILY_ONLY.includes(c.metric)) return;
      ctx.addIssue({
        code: 'custom',
        path: ['conditions', i, 'metric'],
        message: `${RULE_METRIC_LABELS[c.metric].label} is not available for "Last N hours": Meta does not report website conversions by hour. Use "Today" or "Last N days".`,
      });
    });
  }
  if (v.maxBudgetChangePercent && (Number(v.maxBudgetChangePercent) <= 0 || Number(v.maxBudgetChangePercent) > 500)) {
    ctx.addIssue({ code: 'custom', path: ['maxBudgetChangePercent'], message: 'Use 1–500 %' });
  }
  if (v.minBudget && v.maxBudget && Number(v.minBudget) > Number(v.maxBudget)) ctx.addIssue({ code: 'custom', path: ['minBudget'], message: 'Minimum budget is greater than maximum budget' });
}

export const ruleCreateSchema = ruleBaseSchema.superRefine(refineRule);
export const ruleUpdateSchema = ruleBaseSchema.superRefine(refineRule);

export const ruleListQuerySchema = paginationQuerySchema.extend({
  active: z.enum(['true', 'false']).optional(),
});

export const ruleExecutionsQuerySchema = paginationQuerySchema.extend({
  result: z.enum(['SUCCESS', 'FAILED', 'SKIPPED', 'DRY_RUN', 'NOTIFIED', 'PENDING']).optional(),
  ruleId: z.uuid().optional(),
});
