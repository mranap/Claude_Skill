import Decimal from 'decimal.js';
import { currencyDecimals, type MetricsDto } from '@adpilot/shared';

/** Additive base counters stored per day; derived ratios are always recomputed from them. */
export interface BaseCounters {
  spend: Decimal;
  impressions: bigint;
  reach: bigint | null;
  clicks: bigint;
  linkClicks: bigint;
  leads: Decimal;
  purchases: Decimal;
  purchaseValue: Decimal;
  results: Decimal | null;
}

export function emptyCounters(): BaseCounters {
  return {
    spend: new Decimal(0),
    impressions: 0n,
    reach: 0n,
    clicks: 0n,
    linkClicks: 0n,
    leads: new Decimal(0),
    purchases: new Decimal(0),
    purchaseValue: new Decimal(0),
    results: new Decimal(0),
  };
}

export interface CounterRow {
  spend: Decimal.Value | { toString(): string };
  impressions: bigint;
  reach: bigint;
  clicks: bigint;
  linkClicks: bigint;
  leads: Decimal.Value | { toString(): string };
  purchases: Decimal.Value | { toString(): string };
  purchaseValue: Decimal.Value | { toString(): string };
  results: Decimal.Value | { toString(): string } | null;
}

const dec = (v: Decimal.Value | { toString(): string }) => new Decimal(v.toString());

/**
 * Adds a daily row. Reach is NOT additive across days (unique people), so for multi-day ranges it is
 * reported as null instead of a misleading sum; `singleDay` keeps it.
 */
export function addRow(acc: BaseCounters, row: CounterRow, keepReach: boolean): BaseCounters {
  acc.spend = acc.spend.plus(dec(row.spend));
  acc.impressions += row.impressions;
  acc.reach = keepReach && acc.reach !== null ? acc.reach + row.reach : null;
  acc.clicks += row.clicks;
  acc.linkClicks += row.linkClicks;
  acc.leads = acc.leads.plus(dec(row.leads));
  acc.purchases = acc.purchases.plus(dec(row.purchases));
  acc.purchaseValue = acc.purchaseValue.plus(dec(row.purchaseValue));
  acc.results = acc.results !== null && row.results !== null ? acc.results.plus(dec(row.results)) : null;
  return acc;
}

function money(v: Decimal, currency: string): string {
  return v
    .toDecimalPlaces(currencyDecimals(currency), Decimal.ROUND_HALF_UP)
    .toFixed(currencyDecimals(currency));
}

/** Derived metrics exactly like Ads Manager's link-based columns (CTR (link), CPC (link), CPM). */
export function toMetrics(c: BaseCounters, currency: string): MetricsDto {
  const impressions = new Decimal(c.impressions.toString());
  const linkClicks = new Decimal(c.linkClicks.toString());
  return {
    currency,
    spend: money(c.spend, currency),
    impressions: Number(c.impressions),
    reach: c.reach === null ? null : Number(c.reach),
    clicks: Number(c.clicks),
    linkClicks: Number(c.linkClicks),
    ctr: impressions.gt(0) ? linkClicks.div(impressions).times(100).toDecimalPlaces(2).toNumber() : null,
    cpc: linkClicks.gt(0) ? money(c.spend.div(linkClicks), currency) : null,
    cpm: impressions.gt(0) ? money(c.spend.div(impressions).times(1000), currency) : null,
    leads: c.leads.toNumber(),
    cpl: c.leads.gt(0) ? money(c.spend.div(c.leads), currency) : null,
    purchases: c.purchases.toNumber(),
    purchaseValue: money(c.purchaseValue, currency),
    roas: c.spend.gt(0) ? c.purchaseValue.div(c.spend).toDecimalPlaces(2).toNumber() : null,
    results: c.results === null ? null : c.results.toNumber(),
    costPerResult: c.results !== null && c.results.gt(0) ? money(c.spend.div(c.results), currency) : null,
  };
}
