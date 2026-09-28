import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import type { EntityLevel } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { MetaConnection, MetaGraphClient } from '../meta/graph/meta-graph.client';
import { MetaApiError } from '../meta/graph/meta-errors';
import { actId } from '../meta/meta-fields';
import { Prisma, type AdAccount } from '../../generated/prisma/client';

/** Metric fields requested from the Insights API (v26.0). Money values are decimal strings in account currency. */
const METRIC_FIELDS = [
  'account_id',
  'account_currency',
  'date_start',
  'date_stop',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'inline_link_clicks',
  'actions',
  'action_values',
  'video_thruplay_watched_actions',
];

/**
 * Level-specific fields (only fields valid for the requested level are asked for). `results` is Meta's own
 * "Results" metric (the outcome of the optimisation goal and conversion event, as in Ads Manager).
 */
export function insightFields(level: string): string {
  const ids: Record<string, string[]> = {
    account: [],
    campaign: ['campaign_id', 'campaign_name', 'objective', 'results'],
    adset: ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'objective', 'optimization_goal', 'results'],
    ad: ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'objective', 'optimization_goal', 'results'],
  };
  return [...(ids[level] ?? []), ...METRIC_FIELDS].join(',');
}

interface ActionValue {
  action_type: string;
  value: string;
}

export interface InsightRow {
  account_id?: string;
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  objective?: string;
  optimization_goal?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionValue[];
  action_values?: ActionValue[];
  /** ThruPlays (video played to completion or for at least 15 seconds); a separate field, not an `actions` entry. */
  video_thruplay_watched_actions?: ActionValue[];
  /** Meta's "Results": e.g. [{ indicator: 'actions:offsite_conversion.fb_pixel_lead', values: [{ value: '12' }] }]. */
  results?: MetaResult[];
}

export interface MetaResult {
  indicator?: string;
  values?: { value?: string | number; attribution_windows?: string[] }[];
}

const LEVELS: { level: EntityLevel; api: string }[] = [
  { level: 'ACCOUNT', api: 'account' },
  { level: 'CAMPAIGN', api: 'campaign' },
  { level: 'ADSET', api: 'adset' },
  { level: 'AD', api: 'ad' },
];

function num(v: string | undefined): string {
  return v && /^-?\d+(\.\d+)?$/.test(v) ? v : '0';
}

function sumValues(list: ActionValue[] | undefined): string | null {
  if (!list?.length) return null;
  return list.reduce((acc, a) => acc.plus(num(a.value)), new Decimal(0)).toString();
}

function actionValue(list: ActionValue[] | undefined, types: string[]): string | null {
  if (!list) return null;
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return null;
}

/**
 * Leads/purchases are taken from the aggregated action types first ("lead", "omni_purchase"), falling back to
 * the channel-specific ones, so the same conversion is never counted twice.
 */
export function extractConversions(row: InsightRow) {
  const leads =
    actionValue(row.actions, ['lead']) ??
    new Decimal(actionValue(row.actions, ['onsite_conversion.lead_grouped']) ?? 0)
      .plus(actionValue(row.actions, ['offsite_conversion.fb_pixel_lead']) ?? 0)
      .toString();
  const purchases = actionValue(row.actions, ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']) ?? '0';
  const purchaseValue = actionValue(row.action_values, ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']) ?? '0';
  return { leads, purchases, purchaseValue };
}

/** Friendly result type for Meta's result indicator (e.g. "actions:offsite_conversion.fb_pixel_lead" → "leads"). */
export function resultTypeFromIndicator(indicator: string): string {
  const type = indicator.replace(/^actions:/, '');
  if (/thruplay/.test(type)) return 'thruplays';
  if (/lead/.test(type)) return 'leads';
  if (/purchase/.test(type)) return 'purchases';
  const known: Record<string, string> = {
    link_click: 'link_clicks',
    landing_page_view: 'landing_page_views',
    reach: 'reach',
    impressions: 'impressions',
    post_engagement: 'post_engagements',
    like: 'page_likes',
    video_view: 'video_views',
  };
  return known[type] ?? type.replace(/^offsite_conversion\.fb_pixel_/, '').replace(/^onsite_conversion\./, '').slice(0, 60);
}

/** Parses Meta's `results` field; null when absent or not understood (then the local mapping is used). */
export function metaResults(row: InsightRow): { value: string; type: string } | null {
  const list = row.results;
  if (!Array.isArray(list) || !list.length) return null;
  let total = new Decimal(0);
  let indicator: string | undefined;
  let found = false;
  for (const r of list) {
    const values = Array.isArray(r?.values) ? r.values : [];
    // One value per attribution window setting: take the default one only (never sum windows).
    const v = values.find((x) => !x.attribution_windows || x.attribution_windows.includes('default')) ?? values[0];
    const raw = v?.value;
    if (raw === undefined || !/^\d+(\.\d+)?$/.test(String(raw))) continue;
    total = total.plus(String(raw));
    indicator ??= r.indicator;
    found = true;
  }
  if (!found) return null;
  return { value: total.toString(), type: indicator ? resultTypeFromIndicator(indicator) : 'results' };
}

/**
 * "Results" as Ads Manager reports them: Meta's own `results` field when present, otherwise derived from the
 * optimisation goal of the row.
 */
export function computeResults(row: InsightRow, conv: ReturnType<typeof extractConversions>): { value: string | null; type: string | null } {
  const reported = metaResults(row);
  if (reported) return reported;
  const goal = row.optimization_goal ?? '';
  const objective = row.objective ?? '';
  const act = (t: string) => actionValue(row.actions, [t]);
  switch (goal) {
    case 'LEAD_GENERATION':
    case 'QUALITY_LEAD':
      return { value: conv.leads, type: 'leads' };
    case 'OFFSITE_CONVERSIONS':
      return objective === 'OUTCOME_SALES' ? { value: conv.purchases, type: 'purchases' } : { value: conv.leads, type: 'leads' };
    case 'VALUE':
      return { value: conv.purchases, type: 'purchases' };
    case 'LINK_CLICKS':
      return { value: num(row.inline_link_clicks), type: 'link_clicks' };
    case 'LANDING_PAGE_VIEWS':
      return { value: act('landing_page_view'), type: 'landing_page_views' };
    case 'REACH':
      return { value: num(row.reach), type: 'reach' };
    case 'IMPRESSIONS':
      return { value: num(row.impressions), type: 'impressions' };
    case 'THRUPLAY':
      return { value: sumValues(row.video_thruplay_watched_actions), type: 'thruplays' };
    case 'POST_ENGAGEMENT':
      return { value: act('post_engagement'), type: 'post_engagements' };
    case 'PAGE_LIKES':
      return { value: act('like'), type: 'page_likes' };
    default:
      if (objective === 'OUTCOME_LEADS') return { value: conv.leads, type: 'leads' };
      if (objective === 'OUTCOME_SALES') return { value: conv.purchases, type: 'purchases' };
      return { value: null, type: null };
  }
}

export function isTooMuchData(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  const code = err.metaCode;
  const sub = err.metaSubcode;
  if (code === 100 && (sub === 1487534 || sub === 1504018)) return true;
  if (code === 2 && sub === 1504038) return true;
  return /reduce the amount of data|too many rows/i.test(err.details.message ?? '');
}

/**
 * Statistics synchronisation for one ad account. Daily rows (time_increment=1) are fetched per level for a
 * rolling window in the ad account's time zone; the window is re-fetched on every sync because Meta keeps
 * updating recent days (delayed conversions/attribution). Large requests are split into smaller date ranges.
 */
@Injectable()
export class InsightsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphClient,
    private readonly settings: SettingsService,
  ) {}

  async syncAccount(account: AdAccount, conn: MetaConnection, opts: { backfill?: boolean } = {}): Promise<{ rows: number; since: string; until: string }> {
    const cfg = await this.settings.get('statistics');
    const today = DateTime.now().setZone(account.timezoneName);
    const days = !account.statsBackfilledAt || opts.backfill ? cfg.backfillDays : cfg.lookbackDays;
    const since = today.minus({ days: days - 1 }).toFormat('yyyy-MM-dd');
    const until = today.toFormat('yyyy-MM-dd');
    let total = 0;
    for (const { level, api } of LEVELS) {
      const rows = await this.fetchRange(account, conn, api, since, until);
      total += await this.store(account, level, rows);
    }
    return { rows: total, since, until };
  }

  private async fetchRange(account: AdAccount, conn: MetaConnection, level: string, since: string, until: string): Promise<InsightRow[]> {
    try {
      return await this.graph.paginate<InsightRow>(
        conn,
        `/${actId(account.metaAccountId)}/insights`,
        {
          level,
          fields: insightFields(level),
          time_range: { since, until },
          time_increment: 1,
          limit: 500,
        },
        `insights.${level}`,
        { metaAccountId: account.metaAccountId, timeoutMs: 120_000 },
        200_000,
      );
    } catch (err) {
      // Too many rows / request timed out (Insights error codes 100/1487534, 100/1504018, 2/1504038, or the
      // generic "reduce the amount of data" message) → split the date range and try again.
      if (!(isTooMuchData(err) && since !== until)) throw err;
      const s = DateTime.fromISO(since, { zone: 'UTC' });
      const u = DateTime.fromISO(until, { zone: 'UTC' });
      const mid = s.plus({ days: Math.floor(u.diff(s, 'days').days / 2) });
      return [
        ...(await this.fetchRange(account, conn, level, since, mid.toFormat('yyyy-MM-dd'))),
        ...(await this.fetchRange(account, conn, level, mid.plus({ days: 1 }).toFormat('yyyy-MM-dd'), until)),
      ];
    }
  }

  /** Bulk upsert (INSERT … ON CONFLICT) in chunks. */
  private async store(account: AdAccount, level: EntityLevel, rows: InsightRow[]): Promise<number> {
    const records = rows.map((r) => {
      const conv = extractConversions(r);
      const results = computeResults(r, conv);
      const metaObjectId =
        level === 'ACCOUNT' ? account.metaAccountId : level === 'CAMPAIGN' ? r.campaign_id : level === 'ADSET' ? r.adset_id : r.ad_id;
      return {
        metaObjectId: metaObjectId ?? '',
        metaCampaignId: level === 'ACCOUNT' ? null : r.campaign_id ?? null,
        metaAdSetId: level === 'ADSET' || level === 'AD' ? r.adset_id ?? null : null,
        objectName: level === 'ACCOUNT' ? account.name : level === 'CAMPAIGN' ? r.campaign_name : level === 'ADSET' ? r.adset_name : r.ad_name,
        date: r.date_start,
        currency: r.account_currency ?? account.currency,
        spend: num(r.spend),
        impressions: num(r.impressions),
        reach: num(r.reach),
        clicks: num(r.clicks),
        linkClicks: num(r.inline_link_clicks),
        leads: conv.leads,
        purchases: conv.purchases,
        purchaseValue: conv.purchaseValue,
        results: results.value,
        resultType: results.type,
        actions: r.actions ?? null,
        actionValues: r.action_values ?? null,
      };
    }).filter((r) => r.metaObjectId);

    for (let i = 0; i < records.length; i += 300) {
      const chunk = records.slice(i, i + 300);
      const values = chunk.map(
        (r) => Prisma.sql`(${randomUUID()}::uuid, ${account.userId}::uuid, ${account.id}::uuid, ${level}::"EntityLevel", ${r.metaObjectId}, ${r.metaCampaignId}, ${r.metaAdSetId}, ${r.objectName ?? null},
          ${r.date}::date, ${r.currency}, ${r.spend}::numeric, ${r.impressions}::bigint, ${r.reach}::bigint, ${r.clicks}::bigint, ${r.linkClicks}::bigint,
          ${r.leads}::numeric, ${r.purchases}::numeric, ${r.purchaseValue}::numeric, ${r.results}::numeric, ${r.resultType},
          ${r.actions ? JSON.stringify(r.actions) : null}::jsonb, ${r.actionValues ? JSON.stringify(r.actionValues) : null}::jsonb, now())`,
      );
      await this.prisma.$executeRaw`
        INSERT INTO insights_daily (id, "userId", "adAccountId", level, "metaObjectId", "metaCampaignId", "metaAdSetId", "objectName",
          date, currency, spend, impressions, reach, clicks, "linkClicks", leads, purchases, "purchaseValue", results, "resultType",
          actions, "actionValues", "syncedAt")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("adAccountId", level, "metaObjectId", date) DO UPDATE SET
          "metaCampaignId" = EXCLUDED."metaCampaignId", "metaAdSetId" = EXCLUDED."metaAdSetId", "objectName" = EXCLUDED."objectName",
          currency = EXCLUDED.currency, spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, reach = EXCLUDED.reach,
          clicks = EXCLUDED.clicks, "linkClicks" = EXCLUDED."linkClicks", leads = EXCLUDED.leads, purchases = EXCLUDED.purchases,
          "purchaseValue" = EXCLUDED."purchaseValue", results = EXCLUDED.results, "resultType" = EXCLUDED."resultType",
          actions = EXCLUDED.actions, "actionValues" = EXCLUDED."actionValues", "syncedAt" = now()`;
    }
    return records.length;
  }
}
