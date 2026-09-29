import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { defaultSettings } from '@adpilot/shared';
import {
  FULL_REFRESH_EVERY_MS,
  INSIGHTS_SETTLED_AFTER_DAYS,
  InsightsSyncService,
  computeResults,
  extractConversions,
  insightsWindow,
  type InsightRow,
} from '../../src/modules/statistics/insights-sync.service';
import { StatsQueryService } from '../../src/modules/statistics/stats-query.service';
import { MetaApiError, classifyGraphError } from '../../src/modules/meta/graph/meta-errors';
import type { AdAccount } from '../../src/generated/prisma/client';

/** Test doubles implement only what the code under test calls. */
const fake = <T>(value: object): T => value as unknown as T;
const DAY = 86400_000;

describe('statistics look-back and the weekly 28-day refresh', () => {
  const cfg = defaultSettings('statistics');
  const now = Date.parse('2026-09-28T12:00:00Z');
  const account = (fullRefreshAgoMs: number | null) => ({
    statsBackfilledAt: new Date(now - 60 * DAY),
    statsFullRefreshAt: fullRefreshAgoMs === null ? null : new Date(now - fullRefreshAgoMs),
  });

  it('re-reads 8 days by default (7-day click attribution, Conversions API events up to 7 days late)', () => {
    expect(cfg.lookbackDays).toBe(8);
    expect(insightsWindow(account(DAY), cfg, false, now)).toEqual({ days: 8, full: false });
  });

  it('once a week a regular sync re-reads the whole window in which Meta still revises data', () => {
    expect(INSIGHTS_SETTLED_AFTER_DAYS).toBe(28);
    expect(insightsWindow(account(FULL_REFRESH_EVERY_MS - 60_000), cfg, false, now)).toEqual({
      days: 8,
      full: false,
    });
    expect(insightsWindow(account(FULL_REFRESH_EVERY_MS), cfg, false, now)).toEqual({ days: 28, full: true });
    expect(insightsWindow(account(null), cfg, false, now)).toEqual({ days: 28, full: true });
  });

  it('the first sync (or a requested backfill) fetches the backfill period and counts as the refresh', () => {
    expect(insightsWindow({ statsBackfilledAt: null, statsFullRefreshAt: null }, cfg, false, now)).toEqual({
      days: 30,
      full: true,
    });
    expect(insightsWindow(account(DAY), cfg, true, now)).toEqual({ days: 30, full: true });
  });
});

describe('Insights sync storage', () => {
  const account = fake<AdAccount>({
    id: 'acc-1',
    userId: '8d3b4c1e-2f6a-4c55-9d0e-1a2b3c4d5e6f',
    metaAccountId: '1000',
    name: 'Main',
    currency: 'USD',
    timezoneName: 'UTC',
    statsBackfilledAt: new Date(Date.now() - 60 * DAY),
    statsFullRefreshAt: new Date(Date.now() - DAY),
  });
  const row = (id: string, date: string): InsightRow => ({
    campaign_id: id,
    campaign_name: id,
    adset_id: id,
    adset_name: id,
    ad_id: id,
    ad_name: id,
    date_start: date,
    date_stop: date,
    spend: '1.00',
    impressions: '10',
    reach: '8',
    clicks: '1',
    inline_link_clicks: '1',
  });

  type Params = { level: string; time_range: { since: string; until: string }; after?: string };

  /** Meta answers `pages` pages per request; optionally one "reduce the amount of data" error for a level. */
  function setup(pages: number, opts: { tooMuchDataAt?: string } = {}) {
    const events: string[] = [];
    const requests: (Params['time_range'] & { level: string })[] = [];
    let failed = false;
    const graph = {
      get: vi.fn(async (_conn: unknown, _path: string, params: Params) => {
        requests.push({ level: params.level, ...params.time_range });
        if (params.level === opts.tooMuchDataAt && !failed) {
          failed = true;
          throw new MetaApiError(
            classifyGraphError(
              {
                code: 100,
                error_subcode: 1487534,
                message: 'Please reduce the amount of data you are asking for',
              },
              400,
            ),
          );
        }
        const page = Number(params.after ?? 0);
        events.push(`get:${params.level}:${page}`);
        const next = page + 1 < pages ? { next: 'https://graph.example/next' } : {};
        return {
          data: [row(`${params.level}-${page}`, params.time_range.since)],
          paging: { cursors: { after: String(page + 1) }, ...next },
        };
      }),
    };
    const prisma = {
      $executeRaw: vi.fn(async () => (events.push('store'), 1)),
      adAccount: { update: vi.fn(async () => ({})) },
    };
    const service = new InsightsSyncService(
      fake(prisma),
      fake(graph),
      fake({ get: async () => defaultSettings('statistics') }),
    );
    return { events, requests, prisma, service };
  }

  it('stores every page before it requests the next one (at most one page in memory)', async () => {
    const { events, service } = setup(3);
    const res = await service.syncAccount(account, fake({}));
    expect(res.rows).toBe(12); // 4 levels × 3 pages × 1 row
    expect(events.slice(0, 6)).toEqual([
      'get:account:0',
      'store',
      'get:account:1',
      'store',
      'get:account:2',
      'store',
    ]);
  });

  it('records the weekly refresh only for a sync that covered the whole 28-day window', async () => {
    const regular = setup(1);
    const short = await regular.service.syncAccount(account, fake({}));
    expect(DateTime.fromISO(short.until).diff(DateTime.fromISO(short.since), 'days').days).toBe(7);
    expect(regular.prisma.adAccount.update).not.toHaveBeenCalled();

    const due = setup(1);
    const full = await due.service.syncAccount(
      { ...account, statsFullRefreshAt: new Date(Date.now() - 8 * DAY) },
      fake({}),
    );
    expect(DateTime.fromISO(full.until).diff(DateTime.fromISO(full.since), 'days').days).toBe(27);
    expect(due.prisma.adAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { statsFullRefreshAt: expect.any(Date) },
    });
  });

  it('splits a range that returns too much data into halves', async () => {
    const { requests, service } = setup(1, { tooMuchDataAt: 'ad' });
    await service.syncAccount(account, fake({}));
    const ad = requests.filter((r) => r.level === 'ad');
    expect(ad).toHaveLength(3);
    expect(ad[1].since).toBe(ad[0].since);
    expect(ad[2].until).toBe(ad[0].until);
    expect(DateTime.fromISO(ad[2].since).diff(DateTime.fromISO(ad[1].until), 'days').days).toBe(1);
  });
});

describe('aggregations that cannot be added up', () => {
  const base: InsightRow = {
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    spend: '10',
    impressions: '100',
    reach: '80',
    clicks: '5',
    inline_link_clicks: '4',
  };

  it('a campaign whose ad sets have different result types has no "Results"', () => {
    const mixed: InsightRow = {
      ...base,
      objective: 'OUTCOME_LEADS',
      results: [
        {
          indicator: 'actions:offsite_conversion.fb_pixel_lead',
          values: [{ value: '4', attribution_windows: ['default'] }],
        },
        { indicator: 'actions:link_click', values: [{ value: '120', attribution_windows: ['default'] }] },
      ],
    };
    expect(computeResults(mixed, extractConversions(mixed))).toEqual({ value: null, type: null });
    // Results of one type from different sources (website and instant-form leads) still add up.
    const leads: InsightRow = {
      ...base,
      results: [
        { indicator: 'actions:offsite_conversion.fb_pixel_lead', values: [{ value: '4' }] },
        { indicator: 'actions:onsite_conversion.lead_grouped', values: [{ value: '3' }] },
      ],
    };
    expect(computeResults(leads, extractConversions(leads))).toEqual({ value: '7', type: 'leads' });
  });

  it('a single-day total of several ad accounts has no reach (one person can see ads of several accounts)', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    const r = (adAccountId: string, currency: string, reach: bigint) => ({
      adAccountId,
      date,
      currency,
      spend: new Decimal('5.00'),
      impressions: 100n,
      reach,
      clicks: 3n,
      linkClicks: 2n,
      leads: new Decimal(1),
      purchases: new Decimal(0),
      purchaseValue: new Decimal(0),
      results: new Decimal(1),
    });
    const prisma = {
      insightDaily: { findMany: async () => [r('a', 'USD', 100n), r('b', 'USD', 50n), r('c', 'EUR', 70n)] },
    };
    const accounts = [
      { id: 'a', timezoneName: 'UTC', currency: 'USD' },
      { id: 'b', timezoneName: 'UTC', currency: 'USD' },
      { id: 'c', timezoneName: 'UTC', currency: 'EUR' },
    ];
    const totals = await new StatsQueryService(fake(prisma)).totals(accounts, 'custom', {
      from: '2026-09-01',
      to: '2026-09-01',
    });
    expect(totals.byCurrency.get('USD')).toMatchObject({ impressions: 200n, reach: null });
    expect(totals.byCurrency.get('EUR')).toMatchObject({ impressions: 100n, reach: 70n });
    expect(totals.byDay.get('2026-09-01')?.get('USD')?.reach).toBeNull();
    expect(totals.byDay.get('2026-09-01')?.get('EUR')?.reach).toBe(70n);
  });
});
