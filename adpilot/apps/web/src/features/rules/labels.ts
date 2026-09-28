import { RULE_METRIC_LABELS, type RuleMetric } from '@adpilot/shared';
import type { BadgeVariant } from '@/components/ui/badge';
import { formatAmount } from '@/lib/utils/money';
import type { RuleAction, RuleDto, RuleExecutionResult, RuleTargetLevel, RuleTimeRange } from './types';

export const ACTION_LABELS: Record<RuleAction, string> = {
  PAUSE: 'Pause',
  START: 'Start',
  INCREASE_BUDGET: 'Increase budget',
  DECREASE_BUDGET: 'Decrease budget',
  SET_BUDGET: 'Set budget',
  NOTIFY_ONLY: 'Notify only',
};

export const TIME_RANGE_LABELS: Record<RuleTimeRange, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  LAST_N_HOURS: 'Last N hours',
  LAST_N_DAYS: 'Last N days',
};

export const TARGET_LABELS: Record<RuleTargetLevel, { one: string; many: string }> = {
  CAMPAIGN: { one: 'Campaign', many: 'Campaigns' },
  ADSET: { one: 'Ad set', many: 'Ad sets' },
  AD: { one: 'Ad', many: 'Ads' },
};

export const RESULT_LABELS: Record<RuleExecutionResult, { label: string; tone: BadgeVariant }> = {
  SUCCESS: { label: 'Applied', tone: 'success' },
  NOTIFIED: { label: 'Notified', tone: 'info' },
  DRY_RUN: { label: 'Dry run', tone: 'info' },
  SKIPPED: { label: 'Skipped', tone: 'muted' },
  FAILED: { label: 'Failed', tone: 'danger' },
  PENDING: { label: 'Pending', tone: 'warning' },
};

export function isBudgetAction(action: RuleAction | string | undefined): boolean {
  return action === 'INCREASE_BUDGET' || action === 'DECREASE_BUDGET' || action === 'SET_BUDGET';
}

export function metricLabel(metric: RuleMetric | string): string {
  return RULE_METRIC_LABELS[metric as RuleMetric]?.label ?? metric;
}

export function describeTimeRange(rule: Pick<RuleDto, 'timeRange' | 'timeRangeValue'>): string {
  if (rule.timeRange === 'LAST_N_HOURS') return `last ${rule.timeRangeValue ?? '?'} h`;
  if (rule.timeRange === 'LAST_N_DAYS') return `last ${rule.timeRangeValue ?? '?'} days`;
  return rule.timeRange === 'TODAY' ? 'today' : 'yesterday';
}

export function describeAction(rule: Pick<RuleDto, 'action' | 'actionValue' | 'currency'>): string {
  if (rule.action === 'INCREASE_BUDGET') return `Increase budget by ${rule.actionValue ?? '?'} %`;
  if (rule.action === 'DECREASE_BUDGET') return `Decrease budget by ${rule.actionValue ?? '?'} %`;
  if (rule.action === 'SET_BUDGET') return `Set budget to ${rule.actionValue ? formatAmount(rule.actionValue, rule.currency) : '?'}`;
  return ACTION_LABELS[rule.action];
}

/** "every 60 min" / "every 2 h" */
export function describeInterval(minutes: number): string {
  if (minutes % 1440 === 0) return `every ${minutes / 1440 === 1 ? 'day' : `${minutes / 1440} days`}`;
  if (minutes % 60 === 0) return `every ${minutes / 60 === 1 ? 'hour' : `${minutes / 60} h`}`;
  return `every ${minutes} min`;
}
