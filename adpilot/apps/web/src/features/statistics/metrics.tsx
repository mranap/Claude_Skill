import type { MetricsDto } from '@adpilot/shared';
import type { DataTableColumn } from '@/components/shared/data-table';
import { formatAmount } from '@/lib/utils/money';

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? integer.format(value) : decimal.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)} %`;
}

export function formatRoas(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}×`;
}

export type MetricKey = keyof Omit<MetricsDto, 'currency'>;

export interface MetricDef {
  key: MetricKey;
  label: string;
  short?: string;
  kind: 'money' | 'count' | 'percent' | 'ratio';
  hint?: string;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  spend: { key: 'spend', label: 'Spend', kind: 'money' },
  impressions: { key: 'impressions', label: 'Impressions', kind: 'count' },
  reach: { key: 'reach', label: 'Reach', kind: 'count', hint: 'Unique people; not summed across days' },
  clicks: { key: 'clicks', label: 'Clicks (all)', kind: 'count' },
  linkClicks: { key: 'linkClicks', label: 'Link clicks', kind: 'count' },
  ctr: { key: 'ctr', label: 'CTR (link)', short: 'CTR', kind: 'percent' },
  cpc: { key: 'cpc', label: 'CPC (link)', short: 'CPC', kind: 'money' },
  cpm: { key: 'cpm', label: 'CPM', kind: 'money' },
  leads: { key: 'leads', label: 'Leads', kind: 'count' },
  cpl: { key: 'cpl', label: 'Cost per lead', short: 'CPL', kind: 'money' },
  purchases: { key: 'purchases', label: 'Purchases', kind: 'count' },
  purchaseValue: { key: 'purchaseValue', label: 'Purchase value', kind: 'money' },
  roas: { key: 'roas', label: 'ROAS', kind: 'ratio' },
  results: { key: 'results', label: 'Results', kind: 'count' },
  costPerResult: { key: 'costPerResult', label: 'Cost per result', kind: 'money' },
};

/** Formats one metric of a row; money is always shown in the row's own currency. */
export function formatMetric(metrics: MetricsDto | null | undefined, key: MetricKey): string {
  if (!metrics) return '—';
  const value = metrics[key];
  const def = METRICS[key];
  if (value === null || value === undefined) return '—';
  if (def.kind === 'money') return formatAmount(String(value), metrics.currency);
  if (def.kind === 'percent') return formatPercent(value as number);
  if (def.kind === 'ratio') return formatRoas(value as number);
  return formatCount(value as number);
}

/**
 * Metric columns for tables. `sortFields` maps a metric to the server sort field (only the fields the
 * endpoint can sort by become clickable).
 */
export function metricColumns<T>(
  keys: MetricKey[],
  getMetrics: (row: T) => MetricsDto | null | undefined,
  sortFields: readonly string[] = [],
): DataTableColumn<T>[] {
  return keys.map((key) => ({
    id: `m-${key}`,
    header: METRICS[key].short ?? METRICS[key].label,
    sortField: sortFields.includes(key) ? key : undefined,
    align: 'right' as const,
    className: 'tabular-nums whitespace-nowrap',
    cell: (row: T) => {
      const metrics = getMetrics(row);
      const text = formatMetric(metrics, key);
      return <span className={text === '—' ? 'text-muted-foreground' : undefined}>{text}</span>;
    },
  }));
}
