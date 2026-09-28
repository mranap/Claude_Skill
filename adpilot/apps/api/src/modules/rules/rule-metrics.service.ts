import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { currencyDecimals, type RuleMetric } from '@adpilot/shared';
import { MetaConnection, MetaGraphClient } from '../meta/graph/meta-graph.client';
import { actId } from '../meta/meta-fields';
import { BaseCounters, addRow, emptyCounters, toMetrics } from '../statistics/metrics';
import { InsightRow, computeResults, extractConversions } from '../statistics/insights-sync.service';
import type { AdAccount } from '../../generated/prisma/client';

type Level = 'CAMPAIGN' | 'ADSET' | 'AD';
type TimeRange = 'TODAY' | 'YESTERDAY' | 'LAST_N_HOURS' | 'LAST_N_DAYS';

export type MetricValues = Record<RuleMetric, string | null>;

const LEVEL_API: Record<Level, { level: string; idField: 'campaign_id' | 'adset_id' | 'ad_id'; filter: string }> = {
  CAMPAIGN: { level: 'campaign', idField: 'campaign_id', filter: 'campaign.id' },
  ADSET: { level: 'adset', idField: 'adset_id', filter: 'adset.id' },
  AD: { level: 'ad', idField: 'ad_id', filter: 'ad.id' },
};

/**
 * Fresh metrics for rule evaluation, fetched directly from the Insights API at evaluation time (rules must
 * not act on stale data). Dates and hours are computed in the ad account time zone.
 */
@Injectable()
export class RuleMetricsService {
  constructor(private readonly graph: MetaGraphClient) {}

  async fetch(account: AdAccount, conn: MetaConnection, level: Level, metaIds: string[], range: TimeRange, n?: number): Promise<Map<string, MetricValues>> {
    const cfg = LEVEL_API[level];
    const tz = account.timezoneName;
    const now = DateTime.now().setZone(tz);
    const today = now.toFormat('yyyy-MM-dd');
    let since = today;
    let until = today;
    if (range === 'YESTERDAY') since = until = now.minus({ days: 1 }).toFormat('yyyy-MM-dd');
    if (range === 'LAST_N_DAYS') since = now.minus({ days: Math.max(1, n ?? 1) - 1 }).toFormat('yyyy-MM-dd');
    const hourly = range === 'LAST_N_HOURS';
    const windowStart = hourly ? now.minus({ hours: n ?? 1 }) : null;
    if (hourly) since = windowStart!.toFormat('yyyy-MM-dd');

    const counters = new Map<string, BaseCounters>();
    const fields = [cfg.idField, 'objective', ...(level !== 'CAMPAIGN' ? ['optimization_goal'] : []), 'spend', 'impressions', ...(hourly ? [] : ['reach']), 'clicks', 'inline_link_clicks', 'actions', 'action_values'].join(',');
    for (let i = 0; i < metaIds.length; i += 100) {
      const ids = metaIds.slice(i, i + 100);
      const rows = await this.graph.paginate<InsightRow & { hourly_stats_aggregated_by_advertiser_time_zone?: string }>(
        conn,
        `/${actId(account.metaAccountId)}/insights`,
        {
          level: cfg.level,
          fields,
          time_range: { since, until },
          ...(hourly ? { time_increment: 1, breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone' } : { time_increment: 'all_days' }),
          filtering: [{ field: cfg.filter, operator: 'IN', value: ids }],
          use_unified_attribution_setting: true,
          limit: 500,
        },
        'insights.rules',
        { metaAccountId: account.metaAccountId, timeoutMs: 120_000 },
        50_000,
      );
      for (const r of rows) {
        const id = r[cfg.idField];
        if (!id) continue;
        if (hourly && windowStart) {
          const hour = Number((r.hourly_stats_aggregated_by_advertiser_time_zone ?? '00').slice(0, 2));
          const rowStart = DateTime.fromISO(`${r.date_start}T${String(hour).padStart(2, '0')}:00:00`, { zone: tz });
          if (rowStart.plus({ hours: 1 }) <= windowStart) continue;
        }
        const conv = extractConversions(r);
        const res = computeResults(r, conv);
        const acc = counters.get(id) ?? emptyCounters();
        addRow(
          acc,
          {
            spend: r.spend ?? '0',
            impressions: BigInt(r.impressions ?? '0'),
            reach: BigInt(r.reach ?? '0'),
            clicks: BigInt(r.clicks ?? '0'),
            linkClicks: BigInt(r.inline_link_clicks ?? '0'),
            leads: conv.leads,
            purchases: conv.purchases,
            purchaseValue: conv.purchaseValue,
            results: res.value,
          },
          !hourly,
        );
        counters.set(id, acc);
      }
    }
    const out = new Map<string, MetricValues>();
    for (const id of metaIds) out.set(id, this.values(counters.get(id) ?? emptyCounters(), account.currency));
    return out;
  }

  values(c: BaseCounters, currency: string): MetricValues {
    const m = toMetrics(c, currency);
    const purchases = new Decimal(m.purchases);
    return {
      spend: m.spend,
      impressions: String(m.impressions),
      clicks: String(m.linkClicks),
      ctr: m.ctr === null ? null : String(m.ctr),
      cpc: m.cpc,
      cpm: m.cpm,
      leads: String(m.leads),
      cpl: m.cpl,
      purchases: String(m.purchases),
      cpa: purchases.gt(0) ? new Decimal(m.spend).div(purchases).toFixed(currencyDecimals(currency)) : null,
      roas: m.roas === null ? null : String(m.roas),
      results: m.results === null ? null : String(m.results),
      cost_per_result: m.costPerResult,
    };
  }
}
