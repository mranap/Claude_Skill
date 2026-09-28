import { z } from 'zod';
import { paginationQuerySchema } from './common';

/**
 * Date ranges are always evaluated in each ad account's own time zone (the time zone Meta uses for
 * Insights), never in the server's time zone. "last_7d" means the 7 complete days before today, matching
 * Ads Manager; "last_7d_incl_today" is not offered to avoid confusion.
 */
export const DATE_RANGE_KEYS = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'custom'] as const;
export type DateRangeKey = (typeof DATE_RANGE_KEYS)[number];

export const DATE_RANGE_LABELS: Record<DateRangeKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_3d: 'Last 3 days',
  last_7d: 'Last 7 days',
  last_14d: 'Last 14 days',
  last_30d: 'Last 30 days',
  custom: 'Custom',
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const dateRangeQuerySchema = z
  .object({
    range: z.enum(DATE_RANGE_KEYS).default('today'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((v) => v.range !== 'custom' || (v.from && v.to && v.from <= v.to), {
    message: 'Custom range needs from ≤ to',
    path: ['from'],
  });

export const statsQuerySchema = paginationQuerySchema.extend({
  range: z.enum(DATE_RANGE_KEYS).default('last_7d'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  level: z.enum(['CAMPAIGN', 'ADSET', 'AD']).default('CAMPAIGN'),
  adAccountId: z.uuid().optional(),
  campaignId: z.string().regex(/^\d+$/).optional(),
});

/** Aggregated metrics for a row or a total. Money values are decimal strings in the account currency. */
export interface MetricsDto {
  currency: string;
  spend: string;
  impressions: number;
  reach: number | null;
  clicks: number;
  linkClicks: number;
  ctr: number | null;
  cpc: string | null;
  cpm: string | null;
  leads: number;
  cpl: string | null;
  purchases: number;
  purchaseValue: string;
  roas: number | null;
  results: number | null;
  costPerResult: string | null;
}
