import { describe, expect, it } from 'vitest';
import { RULE_METRICS, ruleConditionSchema, type RuleCondition } from '@adpilot/shared';
import { describeCondition, evaluateCondition } from '../../src/modules/rules/rule-engine.service';
import type { MetricValues } from '../../src/modules/rules/rule-metrics.service';
import { eachDate, localToday, resolveRange } from '../../src/modules/statistics/date-range';
import {
  computeResults,
  extractConversions,
  insightFields,
  type InsightRow,
} from '../../src/modules/statistics/insights-sync.service';

function values(partial: Partial<MetricValues>): MetricValues {
  return Object.fromEntries(RULE_METRICS.map((m) => [m, partial[m] ?? null])) as MetricValues;
}
const cond = (c: RuleCondition) => ruleConditionSchema.parse(c);

describe('rule conditions', () => {
  it('compares decimals exactly', () => {
    const v = values({ cpl: '10.10', spend: '0.30' });
    expect(evaluateCondition(cond({ metric: 'cpl', operator: 'gt', value: '10.1' }), v).ok).toBe(false);
    expect(evaluateCondition(cond({ metric: 'cpl', operator: 'gte', value: '10.1' }), v).ok).toBe(true);
    expect(evaluateCondition(cond({ metric: 'spend', operator: 'eq', value: '0.3' }), v).ok).toBe(true);
    expect(evaluateCondition(cond({ metric: 'spend', operator: 'lt', value: '0.31' }), v)).toEqual({
      ok: true,
      actual: '0.30',
    });
  });

  it('supports inclusive between', () => {
    const v = values({ ctr: '1.5' });
    expect(
      evaluateCondition(cond({ metric: 'ctr', operator: 'between', value: '1.5', valueTo: '2' }), v).ok,
    ).toBe(true);
    expect(
      evaluateCondition(cond({ metric: 'ctr', operator: 'between', value: '1.6', valueTo: '2' }), v).ok,
    ).toBe(false);
  });

  it('never matches a metric without data (e.g. CPL with zero leads)', () => {
    expect(evaluateCondition(cond({ metric: 'cpl', operator: 'lt', value: '1000' }), values({}))).toEqual({
      ok: false,
      actual: null,
    });
  });

  it('rejects an invalid between range and non-numeric values', () => {
    expect(() => cond({ metric: 'ctr', operator: 'between', value: '2', valueTo: '1' })).toThrow();
    expect(() => cond({ metric: 'ctr', operator: 'gt', value: '1e5' })).toThrow();
  });

  it('describes conditions with the currency for money metrics', () => {
    expect(describeCondition(cond({ metric: 'cpl', operator: 'gt', value: '12' }), 'EUR')).toBe(
      'Cost per lead (CPL) > 12 EUR',
    );
    expect(
      describeCondition(cond({ metric: 'ctr', operator: 'between', value: '1', valueTo: '2' }), 'EUR'),
    ).toBe('CTR (link), % between 1 and 2');
  });
});

describe('date ranges in the ad account time zone', () => {
  // 2026-03-01 02:30 UTC is still 2026-02-28 in Los Angeles and already 2026-03-01 in Kyiv.
  const now = new Date('2026-03-01T02:30:00Z');

  it('computes "today" per account time zone', () => {
    expect(localToday('America/Los_Angeles', now)).toBe('2026-02-28');
    expect(localToday('Europe/Kyiv', now)).toBe('2026-03-01');
    expect(localToday('Asia/Tokyo', now)).toBe('2026-03-01');
  });

  it('excludes today from "last N days" (Ads Manager semantics)', () => {
    expect(resolveRange('last_7d', 'America/Los_Angeles', undefined, now)).toEqual({
      since: '2026-02-21',
      until: '2026-02-27',
    });
    expect(resolveRange('yesterday', 'Europe/Kyiv', undefined, now)).toEqual({
      since: '2026-02-28',
      until: '2026-02-28',
    });
  });

  it('handles DST transitions without skipping or duplicating days', () => {
    const dst = new Date('2026-03-09T12:00:00Z'); // US DST started on 2026-03-08
    expect(resolveRange('last_3d', 'America/New_York', undefined, dst)).toEqual({
      since: '2026-03-06',
      until: '2026-03-08',
    });
    expect(eachDate({ since: '2026-03-06', until: '2026-03-09' })).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
  });

  it('falls back to UTC for an unknown time zone', () => {
    expect(localToday('Not/AZone', now)).toBe('2026-03-01');
  });
});

describe('Insights extraction', () => {
  const base: InsightRow = {
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    spend: '12.34',
    impressions: '1000',
    reach: '800',
    clicks: '40',
    inline_link_clicks: '30',
  };

  it('requests only level-appropriate identity fields', () => {
    expect(insightFields('account')).not.toContain('campaign_id');
    expect(insightFields('adset')).toContain('adset_id');
    expect(insightFields('adset')).not.toContain('ad_id');
    expect(insightFields('ad')).toContain('video_thruplay_watched_actions');
  });

  it('prefers the aggregated lead action and never double counts', () => {
    const row = {
      ...base,
      actions: [
        { action_type: 'lead', value: '5' },
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' },
        { action_type: 'onsite_conversion.lead_grouped', value: '2' },
      ],
    };
    expect(extractConversions(row).leads).toBe('5');
    const fallback = {
      ...base,
      actions: [
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' },
        { action_type: 'onsite_conversion.lead_grouped', value: '2' },
      ],
    };
    expect(extractConversions(fallback).leads).toBe('5');
    expect(extractConversions(base).leads).toBe('0');
  });

  it('takes purchases and value from omni_purchase first', () => {
    const row = {
      ...base,
      actions: [
        { action_type: 'omni_purchase', value: '4' },
        { action_type: 'purchase', value: '4' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '4' },
      ],
      action_values: [
        { action_type: 'omni_purchase', value: '199.90' },
        { action_type: 'purchase', value: '199.90' },
      ],
    };
    expect(extractConversions(row)).toEqual({ leads: '0', purchases: '4', purchaseValue: '199.90' });
  });

  it('computes results for the optimisation goal', () => {
    const conv = { leads: '7', purchases: '2', purchaseValue: '50' };
    expect(
      computeResults({ ...base, optimization_goal: 'OFFSITE_CONVERSIONS', objective: 'OUTCOME_LEADS' }, conv),
    ).toEqual({ value: '7', type: 'leads' });
    expect(
      computeResults({ ...base, optimization_goal: 'OFFSITE_CONVERSIONS', objective: 'OUTCOME_SALES' }, conv),
    ).toEqual({ value: '2', type: 'purchases' });
    expect(computeResults({ ...base, optimization_goal: 'LINK_CLICKS' }, conv)).toEqual({
      value: '30',
      type: 'link_clicks',
    });
    expect(computeResults({ ...base, optimization_goal: 'REACH' }, conv)).toEqual({
      value: '800',
      type: 'reach',
    });
    expect(computeResults({ ...base }, conv)).toEqual({ value: null, type: null });
  });

  it('counts ThruPlays from video_thruplay_watched_actions, not 3-second views', () => {
    const row = {
      ...base,
      optimization_goal: 'THRUPLAY',
      actions: [{ action_type: 'video_view', value: '900' }],
      video_thruplay_watched_actions: [{ action_type: 'video_view', value: '120' }],
    };
    expect(computeResults(row, extractConversions(row))).toEqual({ value: '120', type: 'thruplays' });
    expect(computeResults({ ...base, optimization_goal: 'THRUPLAY' }, extractConversions(base))).toEqual({
      value: null,
      type: 'thruplays',
    });
  });
});
