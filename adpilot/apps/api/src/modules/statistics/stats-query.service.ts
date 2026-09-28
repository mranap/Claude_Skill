import { Injectable } from '@nestjs/common';
import type { DateRangeKey, EntityLevel } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BaseCounters, addRow, emptyCounters } from './metrics';
import { LocalRange, eachDate, fromDbDate, resolveRange, toDbDate } from './date-range';

export interface AccountRef {
  id: string;
  timezoneName: string;
  currency: string;
  name?: string;
}

export interface AggregatedObject {
  metaObjectId: string;
  adAccountId: string;
  currency: string;
  name: string | null;
  metaCampaignId: string | null;
  metaAdSetId: string | null;
  counters: BaseCounters;
}

/**
 * Reads synced daily Insights rows and aggregates them per object / per day, applying each ad account's
 * own local date range (so "Today" is correct for accounts in different time zones).
 */
@Injectable()
export class StatsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  ranges(accounts: AccountRef[], key: DateRangeKey, custom?: { from?: string; to?: string }): Map<string, LocalRange> {
    return new Map(accounts.map((a) => [a.id, resolveRange(key, a.timezoneName, custom)]));
  }

  private async rows(accounts: AccountRef[], ranges: Map<string, LocalRange>, level: EntityLevel, filter: { metaObjectIds?: string[]; metaCampaignId?: string }) {
    if (!accounts.length) return [];
    const all = [...ranges.values()];
    const minSince = all.reduce((m, r) => (r.since < m ? r.since : m), all[0]!.since);
    const maxUntil = all.reduce((m, r) => (r.until > m ? r.until : m), all[0]!.until);
    const rows = await this.prisma.insightDaily.findMany({
      where: {
        adAccountId: { in: accounts.map((a) => a.id) },
        level,
        date: { gte: toDbDate(minSince), lte: toDbDate(maxUntil) },
        ...(filter.metaObjectIds ? { metaObjectId: { in: filter.metaObjectIds } } : {}),
        ...(filter.metaCampaignId ? { metaCampaignId: filter.metaCampaignId } : {}),
      },
    });
    return rows.filter((r) => {
      const range = ranges.get(r.adAccountId)!;
      const d = fromDbDate(r.date);
      return d >= range.since && d <= range.until;
    });
  }

  async byObject(
    accounts: AccountRef[],
    key: DateRangeKey,
    level: EntityLevel,
    opts: { custom?: { from?: string; to?: string }; metaObjectIds?: string[]; metaCampaignId?: string } = {},
  ): Promise<Map<string, AggregatedObject>> {
    const ranges = this.ranges(accounts, key, opts.custom);
    const singleDay = [...ranges.values()].every((r) => r.since === r.until);
    const rows = await this.rows(accounts, ranges, level, opts);
    const currency = new Map(accounts.map((a) => [a.id, a.currency]));
    const out = new Map<string, AggregatedObject>();
    for (const r of rows) {
      let agg = out.get(r.metaObjectId);
      if (!agg) {
        agg = {
          metaObjectId: r.metaObjectId,
          adAccountId: r.adAccountId,
          currency: currency.get(r.adAccountId) ?? r.currency,
          name: r.objectName,
          metaCampaignId: r.metaCampaignId,
          metaAdSetId: r.metaAdSetId,
          counters: emptyCounters(),
        };
        out.set(r.metaObjectId, agg);
      }
      addRow(agg.counters, r, singleDay);
      if (r.objectName) agg.name = r.objectName;
    }
    return out;
  }

  /** Per-currency totals and per-day series (account level rows). */
  async totals(accounts: AccountRef[], key: DateRangeKey, custom?: { from?: string; to?: string }) {
    const ranges = this.ranges(accounts, key, custom);
    const singleDay = [...ranges.values()].every((r) => r.since === r.until);
    const rows = await this.rows(accounts, ranges, 'ACCOUNT', {});
    const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
    const byCurrency = new Map<string, BaseCounters>();
    const byDay = new Map<string, Map<string, BaseCounters>>();
    for (const r of rows) {
      const cur = currencyOf.get(r.adAccountId) ?? r.currency;
      byCurrency.set(cur, addRow(byCurrency.get(cur) ?? emptyCounters(), r, singleDay));
      const day = fromDbDate(r.date);
      const perDay = byDay.get(day) ?? new Map<string, BaseCounters>();
      perDay.set(cur, addRow(perDay.get(cur) ?? emptyCounters(), r, true));
      byDay.set(day, perDay);
    }
    const allDays = new Set<string>();
    for (const r of ranges.values()) for (const d of eachDate(r)) allDays.add(d);
    return { byCurrency, byDay, days: [...allDays].sort(), ranges };
  }
}
