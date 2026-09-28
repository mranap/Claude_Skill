import type { RuleCondition, RuleMetric } from '@adpilot/shared';
import type { ISODateString } from '@/lib/api/types';

export type RuleTargetLevel = 'CAMPAIGN' | 'ADSET' | 'AD';
export type RuleTimeRange = 'TODAY' | 'YESTERDAY' | 'LAST_N_HOURS' | 'LAST_N_DAYS';
export type RuleAction = 'PAUSE' | 'START' | 'INCREASE_BUDGET' | 'DECREASE_BUDGET' | 'SET_BUDGET' | 'NOTIFY_ONLY';
export type RuleExecutionResult = 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'DRY_RUN' | 'NOTIFIED';

/** GET /rules/:id (and list items with `stats7d`). Decimal columns arrive as strings. */
export interface RuleDto {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isDryRun: boolean;
  targetLevel: RuleTargetLevel;
  scope: { adAccountIds: string[]; campaignIds?: string[]; nameContains?: string };
  conditions: RuleCondition[];
  timeRange: RuleTimeRange;
  timeRangeValue: number | null;
  action: RuleAction;
  actionValue: string | null;
  actionValueType: 'ABSOLUTE' | 'PERCENT' | null;
  /** Currency of the money amounts (all scoped ad accounts share it). */
  currency: string | null;
  maxBudgetChangePercent: string | null;
  minBudget: string | null;
  maxBudget: string | null;
  cooldownMinutes: number;
  maxActionsPerDay: number;
  checkIntervalMinutes: number;
  notify: boolean;
  nextRunAt: ISODateString | null;
  lastRunAt: ISODateString | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** "Cost per lead (CPL) > 10 USD AND …" */
  summary: string;
  stats7d?: Partial<Record<RuleExecutionResult, number>>;
}

export interface RuleExecutionDto {
  id: string;
  ruleId: string;
  runId: string;
  adAccountId: string | null;
  entityLevel: RuleTargetLevel;
  entityMetaId: string;
  entityName: string | null;
  action: RuleAction;
  result: RuleExecutionResult;
  oldValue: string | null;
  newValue: string | null;
  /** Budget values in minor units are formatted by the server ("25.00 USD"). */
  oldValueDisplay: string | null;
  newValueDisplay: string | null;
  conditionData: {
    timeRange?: RuleTimeRange;
    timeRangeValue?: number | null;
    metrics?: Partial<Record<RuleMetric, number | string | null>>;
    conditions?: { text: string; actual: number | string | null }[];
  } | null;
  reason: string | null;
  errorMessage: string | null;
  errorCode: number | null;
  isDryRun: boolean;
  executedAt: ISODateString;
  ruleName: string;
}
