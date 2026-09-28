import { DateTime } from 'luxon';
import type { DateRangeKey } from '@adpilot/shared';

export interface LocalRange {
  /** Inclusive local dates (YYYY-MM-DD) in the ad account time zone. */
  since: string;
  until: string;
}

/** Resolves a range key for one ad account time zone (Meta computes "today" in the account's time zone). */
export function resolveRange(key: DateRangeKey, timezone: string, custom?: { from?: string; to?: string }, now = new Date()): LocalRange {
  const zone = DateTime.fromJSDate(now).setZone(timezone).isValid ? timezone : 'UTC';
  const today = DateTime.fromJSDate(now).setZone(zone).startOf('day');
  const fmt = (d: DateTime) => d.toFormat('yyyy-MM-dd');
  switch (key) {
    case 'today':
      return { since: fmt(today), until: fmt(today) };
    case 'yesterday':
      return { since: fmt(today.minus({ days: 1 })), until: fmt(today.minus({ days: 1 })) };
    case 'last_3d':
      return { since: fmt(today.minus({ days: 3 })), until: fmt(today.minus({ days: 1 })) };
    case 'last_7d':
      return { since: fmt(today.minus({ days: 7 })), until: fmt(today.minus({ days: 1 })) };
    case 'last_14d':
      return { since: fmt(today.minus({ days: 14 })), until: fmt(today.minus({ days: 1 })) };
    case 'last_30d':
      return { since: fmt(today.minus({ days: 30 })), until: fmt(today.minus({ days: 1 })) };
    case 'custom':
      return { since: custom?.from ?? fmt(today), until: custom?.to ?? fmt(today) };
  }
}

export function localToday(timezone: string, now = new Date()): string {
  return resolveRange('today', timezone, undefined, now).since;
}

/** Inclusive list of dates between since and until. */
export function eachDate(range: LocalRange): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(range.since, { zone: 'UTC' });
  const end = DateTime.fromISO(range.until, { zone: 'UTC' });
  for (let i = 0; d <= end && i < 1000; i++, d = d.plus({ days: 1 })) out.push(d.toFormat('yyyy-MM-dd'));
  return out;
}

export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
