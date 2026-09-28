import type { MetricsDto, SyncStatus } from '@adpilot/shared';
import type { BigIntString, ISODateString, Paginated } from '@/lib/api/types';

export type StatsLevel = 'CAMPAIGN' | 'ADSET' | 'AD';

/** Local mirror of the object behind a statistics row (status, budgets in minor units). */
export interface StatsEntity {
  id: string;
  campaignId?: string;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget?: BigIntString | null;
  lifetimeBudget?: BigIntString | null;
}

/** GET /statistics row: one object with delivery in the range. Money values are decimal strings in `metrics.currency`. */
export interface StatsRow {
  metaObjectId: string;
  name: string | null;
  adAccountId: string;
  adAccountName: string | null;
  metaCampaignId: string | null;
  metaAdSetId: string | null;
  metrics: MetricsDto;
  entity: StatsEntity | null;
}

/** One day of the primary currency (account-level rows). */
export interface StatsSeriesPoint {
  date: string;
  spend: string;
  leads: number;
  cpl: string | null;
  clicks: number;
  impressions: number;
}

export interface StatsSyncInfo {
  adAccountId: string;
  name: string;
  lastStatsSyncAt: ISODateString | null;
  status: SyncStatus;
  lastManualRefreshAt: ISODateString | null;
  /** When a manual refresh is allowed again for this account (the server enforces it). */
  nextManualRefreshAt?: ISODateString | null;
  timezoneName?: string;
  error?: string | null;
}

export interface StatsTableResponse extends Paginated<StatsRow> {
  /** Totals per currency (amounts in different currencies are never added up). */
  totals: MetricsDto[];
  series: StatsSeriesPoint[];
  primaryCurrency: string;
  sync: StatsSyncInfo[];
}

export interface StatsRefreshResponse {
  results: { adAccountId: string; queued: boolean; retryAfterSeconds?: number }[];
  cooldownMinutes: number;
}
