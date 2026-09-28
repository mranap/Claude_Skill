import { formatDistanceToNowStrict } from 'date-fns';

type DateInput = string | number | Date | null | undefined;

/**
 * Time zone used to display absolute dates. It follows the signed-in user's profile setting (see
 * AuthProvider) and falls back to the browser's zone.
 */
let displayTimeZone: string | undefined;

export function setDisplayTimeZone(timeZone: string | undefined): void {
  const next = timeZone && isValidTimeZone(timeZone) ? timeZone : undefined;
  if (next === displayTimeZone) return;
  displayTimeZone = next;
  formatterCache.clear();
}

export function getDisplayTimeZone(): string {
  return displayTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${key}|${displayTimeZone ?? ''}`;
  let fmt = formatterCache.get(cacheKey);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { ...options, timeZone: displayTimeZone });
    formatterCache.set(cacheKey, fmt);
  }
  return fmt;
}

export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Sep 28, 2026, 14:03" */
export function formatDateTime(value: DateInput, opts: { seconds?: boolean } = {}): string {
  const date = toDate(value);
  if (!date) return '—';
  return formatter(opts.seconds ? 'dts' : 'dt', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(date);
}

/** "Sep 28, 2026" */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return '—';
  return formatter('d', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/** "14:03:12" */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return '—';
  return formatter('t', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
}

/** "3 min ago", "in 2 days", "just now". */
export function formatRelative(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value);
  if (!date) return '—';
  const diff = date.getTime() - now;
  if (Math.abs(diff) < 45_000) return 'just now';
  const text = formatDistanceToNowStrict(date, { roundingMethod: 'floor' })
    .replace(/ seconds?/, ' s')
    .replace(/ minutes?/, ' min')
    .replace(/ hours?/, ' h');
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

const numberFormat = new Intl.NumberFormat('en-US');

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? numberFormat.format(n) : String(value);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Accepts BigInt values serialised as strings by the API. */
export function formatBytes(value: number | string | bigint | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  let n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return String(value);
  let unit = 0;
  while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : n >= 100 ? 0 : decimals;
  return `${n.toFixed(digits).replace(/\.0+$/, '')} ${BYTE_UNITS[unit]}`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** 35 → "35 min", 60 → "1 h", 90 → "1 h 30 min", 1440 → "1 day". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "mm:ss" countdown label. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
