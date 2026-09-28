import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { RULE_METRICS_DAILY_ONLY, ruleConditionSchema, ruleCreateSchema, type RuleCondition } from '@adpilot/shared';
import { evaluateCondition, planBudgetChange, type BudgetBounds } from '../../src/modules/rules/rule-engine.service';
import { RuleMetricsService } from '../../src/modules/rules/rule-metrics.service';
import { mayHaveBeenApplied } from '../../src/modules/campaigns/entity-actions.service';
import { MetaApiError, MetaNetworkError, classifyGraphError } from '../../src/modules/meta/graph/meta-errors';
import { AppError } from '../../src/common/errors/app-error';
import type { MetaConnection, MetaGraphClient } from '../../src/modules/meta/graph/meta-graph.client';
import type { AdAccount } from '../../src/generated/prisma/client';

const bounds = (b: Partial<BudgetBounds> = {}): BudgetBounds => ({ maxChangePercent: null, min: null, max: null, accountMin: null, ...b });

describe('budget rule bounds', () => {
  it('never lets a maximum turn an increase into a cut', () => {
    // +20 % on 800.00 with a maximum of 500.00 used to set 500.00 (−37.5 %).
    expect(planBudgetChange('INCREASE_BUDGET', 80000n, '20', bounds({ maxChangePercent: '20', max: 50000n }), 'USD')).toEqual({
      skip: 'Budget 800.00 USD is already at or above the maximum 500.00 USD',
    });
    expect(planBudgetChange('SET_BUDGET', 80000n, '900', bounds({ max: 50000n }), 'USD')).toHaveProperty('skip');
  });

  it('never lets a minimum turn a decrease into a raise', () => {
    // −20 % on 30.00 with a minimum of 50.00 used to set 50.00 (+67 %).
    expect(planBudgetChange('DECREASE_BUDGET', 3000n, '20', bounds({ min: 5000n }), 'USD')).toEqual({ skip: 'Budget 30.00 USD is already at or below the minimum 50.00 USD' });
    expect(planBudgetChange('DECREASE_BUDGET', 3000n, '20', bounds({ accountMin: 5000n }), 'USD')).toHaveProperty('skip');
    expect(planBudgetChange('SET_BUDGET', 3000n, '10', bounds({ min: 5000n }), 'USD')).toHaveProperty('skip');
  });

  it('applies the maximum change per execution after the bounds', () => {
    // A minimum above the current budget may raise it, but never by more than the maximum change.
    expect(planBudgetChange('INCREASE_BUDGET', 3000n, '20', bounds({ maxChangePercent: '20', min: 5000n }), 'USD')).toEqual({ next: 3600n, note: 'limited to +20 % per execution' });
    expect(planBudgetChange('DECREASE_BUDGET', 80000n, '10', bounds({ maxChangePercent: '20', max: 50000n }), 'USD')).toEqual({ next: 64000n, note: 'limited to −20 % per execution' });
    expect(planBudgetChange('SET_BUDGET', 5000n, '100', bounds({ maxChangePercent: '30' }), 'USD')).toEqual({ next: 6500n, note: 'limited to +30 % per execution' });
  });

  it('keeps the minimum and maximum when they are within the allowed change', () => {
    expect(planBudgetChange('DECREASE_BUDGET', 4000n, '20', bounds({ min: 3500n, accountMin: 100n }), 'USD')).toEqual({ next: 3500n, note: 'kept at minimum 35.00 USD' });
    expect(planBudgetChange('INCREASE_BUDGET', 7200n, '100', bounds({ maxChangePercent: '30', max: 8000n }), 'USD')).toEqual({ next: 8000n, note: 'capped at maximum 80.00 USD' });
    expect(planBudgetChange('INCREASE_BUDGET', 1000n, '20', bounds(), 'JPY')).toEqual({ next: 1200n, note: null });
  });

  it('skips a change that rounds to nothing', () => {
    expect(planBudgetChange('INCREASE_BUDGET', 1n, '20', bounds(), 'USD')).toEqual({ skip: 'Budget already at the limit (0.01 USD)' });
    expect(planBudgetChange('SET_BUDGET', 2500n, '25', bounds(), 'USD')).toHaveProperty('skip');
  });
});

describe('ambiguous action failures', () => {
  // The same wrapping EntityActionsService applies to Meta errors.
  const wrapped = (e: MetaApiError) => new AppError('META_API_ERROR', e.details.friendlyMessage, undefined, { meta: e.details, cause: e });
  const graphError = (code: number, httpStatus: number, extra: Record<string, unknown> = {}) => new MetaApiError(classifyGraphError({ code, message: 'x', ...extra }, httpStatus));

  it('treats a sent request without an answer, and unknown or server-side errors, as possibly applied', () => {
    expect(mayHaveBeenApplied(wrapped(new MetaNetworkError('socket hang up', true, false, 'ECONNRESET')))).toBe(true);
    expect(mayHaveBeenApplied(wrapped(graphError(2, 503, { is_transient: true })))).toBe(true);
    expect(mayHaveBeenApplied(wrapped(new MetaApiError(classifyGraphError({ message: 'x' }, 200))))).toBe(true); // UNKNOWN
    expect(mayHaveBeenApplied(new Error('connection to the database lost'))).toBe(true);
  });

  it('treats requests that never left and definite refusals as not applied', () => {
    expect(mayHaveBeenApplied(wrapped(new MetaNetworkError('connect ECONNREFUSED', false, false, 'ECONNREFUSED')))).toBe(false);
    expect(mayHaveBeenApplied(wrapped(new MetaNetworkError('proxy authentication failed', false, true)))).toBe(false);
    for (const [code, status] of [[17, 400], [100, 400], [200, 403], [190, 401], [368, 400], [803, 400]]) {
      expect(mayHaveBeenApplied(wrapped(graphError(code, status)))).toBe(false);
    }
    expect(mayHaveBeenApplied(AppError.validation('The budget must be greater than zero'))).toBe(false);
  });
});

describe('rule metrics', () => {
  const account = { metaAccountId: '1000', timezoneName: 'Europe/Warsaw', currency: 'USD' } as AdAccount;
  const conn = {} as MetaConnection;
  const service = (rows: Record<string, unknown>[]) => new RuleMetricsService({ paginate: async () => rows } as unknown as MetaGraphClient);
  const cond = (c: RuleCondition) => ruleConditionSchema.parse(c);
  const pixelLeads = { actions: [{ action_type: 'lead', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' }] };

  it('does not evaluate outcome counts of an object without delivery (no Insights row)', async () => {
    const today = DateTime.now().setZone('Europe/Warsaw').toFormat('yyyy-MM-dd');
    const rows = [{ adset_id: 'A', date_start: today, date_stop: today, spend: '12.00', impressions: '900', inline_link_clicks: '9', optimization_goal: 'OFFSITE_CONVERSIONS', objective: 'OUTCOME_LEADS', ...pixelLeads }];
    const values = await service(rows).fetch(account, conn, 'ADSET', ['A', 'B'], 'TODAY');
    expect(values.get('A')).toMatchObject({ spend: '12.00', impressions: '900', clicks: '9', leads: '3', results: '3', cpl: '4.00' });
    const idle = values.get('B')!;
    expect(idle).toMatchObject({ spend: '0.00', impressions: '0', clicks: null, leads: null, purchases: null, results: null, cpl: null, cost_per_result: null });
    // "Results < 1 → pause" leaves a new ad set alone; "spend < 1" still finds ad sets that do not deliver.
    expect(evaluateCondition(cond({ metric: 'results', operator: 'lt', value: '1' }), idle).ok).toBe(false);
    expect(evaluateCondition(cond({ metric: 'spend', operator: 'lt', value: '1' }), idle).ok).toBe(true);
  });

  it('never evaluates conversion metrics for "Last N hours" (hourly rows lack website conversions)', async () => {
    const now = DateTime.now().setZone('Europe/Warsaw');
    const hour = now.toFormat('HH');
    const rows = [
      { adset_id: 'A', date_start: now.toFormat('yyyy-MM-dd'), date_stop: now.toFormat('yyyy-MM-dd'), hourly_stats_aggregated_by_advertiser_time_zone: `${hour}:00:00 - ${hour}:59:59`, spend: '5.00', impressions: '400', inline_link_clicks: '4', ...pixelLeads },
    ];
    const v = (await service(rows).fetch(account, conn, 'ADSET', ['A'], 'LAST_N_HOURS', 3)).get('A')!;
    expect(v).toMatchObject({ spend: '5.00', impressions: '400', clicks: '4', ctr: '1', cpc: '1.25' });
    for (const m of RULE_METRICS_DAILY_ONLY) expect(v[m]).toBeNull();
  });

  it('rejects conversion metrics with "Last N hours" when a rule is saved', () => {
    const base = { name: 'r', targetLevel: 'ADSET', scope: { adAccountIds: ['00000000-0000-4000-8000-000000000000'] }, timeRange: 'LAST_N_HOURS', timeRangeValue: 6, action: 'PAUSE' } as const;
    for (const metric of RULE_METRICS_DAILY_ONLY) {
      const res = ruleCreateSchema.safeParse({ ...base, conditions: [{ metric: 'spend', operator: 'gt', value: '50' }, { metric, operator: 'lt', value: '1' }] });
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]).toMatchObject({ path: ['conditions', 1, 'metric'] });
    }
    expect(ruleCreateSchema.safeParse({ ...base, conditions: [{ metric: 'ctr', operator: 'lt', value: '0.5' }, { metric: 'clicks', operator: 'lt', value: '3' }] }).success).toBe(true);
    expect(ruleCreateSchema.safeParse({ ...base, timeRange: 'TODAY', conditions: [{ metric: 'leads', operator: 'lt', value: '1' }] }).success).toBe(true);
  });
});
