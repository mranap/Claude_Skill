'use client';

import { ChartColumn, Table2 } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DailyChart, formatDay, type DailyPoint } from '@/components/product/daily-chart';
import { cn } from '@/lib/utils/cn';
import { compactMoney, compactNumber, formatAmount } from '@/lib/utils/money';
import { formatCount } from './metrics';
import type { StatsSeriesPoint } from './types';

type SeriesMetric = 'spend' | 'leads' | 'cpl' | 'clicks' | 'impressions';

const SERIES_METRICS: { value: SeriesMetric; label: string; money: boolean }[] = [
  { value: 'spend', label: 'Spend', money: true },
  { value: 'leads', label: 'Leads', money: false },
  { value: 'cpl', label: 'CPL', money: true },
  { value: 'clicks', label: 'Link clicks', money: false },
  { value: 'impressions', label: 'Impressions', money: false },
];

function toPoints(series: StatsSeriesPoint[], metric: SeriesMetric, currency: string): DailyPoint[] {
  return series.map((p) => {
    const raw = p[metric];
    if (raw === null || raw === undefined) return { date: p.date, value: null, display: '—' };
    const money = metric === 'spend' || metric === 'cpl';
    return {
      date: p.date,
      // Geometry only; the tooltip shows the exact decimal string.
      value: Number(raw),
      display: money ? formatAmount(String(raw), currency) : formatCount(Number(raw)),
    };
  });
}

/**
 * Daily series of the primary currency with a metric switcher and a table view. Amounts in other
 * currencies are not converted or added: the description says which currency is charted.
 */
export function SeriesCard({
  series,
  currency,
  loading = false,
  fetching = false,
  title = 'Daily performance',
  description,
  className,
}: {
  series: StatsSeriesPoint[] | undefined;
  currency: string | undefined;
  loading?: boolean;
  fetching?: boolean;
  title?: string;
  description?: React.ReactNode;
  className?: string;
}) {
  const [metric, setMetric] = useState<SeriesMetric>('spend');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const def = SERIES_METRICS.find((m) => m.value === metric)!;
  const cur = currency ?? 'USD';
  const points = toPoints(series ?? [], metric, cur);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            aria-label="Metric"
            value={metric}
            onValueChange={setMetric}
            options={SERIES_METRICS.map((m) => ({ value: m.value, label: m.label }))}
          />
          <SegmentedControl
            size="sm"
            aria-label="View"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'chart', label: <ChartColumn className="size-4" aria-hidden />, title: 'Chart' },
              { value: 'table', label: <Table2 className="size-4" aria-hidden />, title: 'Table' },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className={cn('transition-opacity', fetching && 'opacity-70')}>
        {loading && !series ? (
          <Skeleton className="h-[220px] w-full" />
        ) : view === 'chart' ? (
          <DailyChart
            points={points}
            ariaLabel={`${def.label} per day in ${cur}`}
            axisLabel={(v) => (def.money ? compactMoney(v, cur) : compactNumber(v))}
            emptyText={metric === 'cpl' ? 'No leads in this period' : 'No delivery in this period'}
          />
        ) : (
          <div className="max-h-[320px] overflow-auto rounded-md border">
            <Table aria-label="Daily values">
              <TableHeader className="sticky top-0 bg-surface-subtle">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">Link clicks</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(series ?? []).map((p) => (
                  <TableRow key={p.date}>
                    <TableCell className="whitespace-nowrap">{formatDay(p.date, 'EEE, MMM d')}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(p.spend, cur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(p.leads)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(p.cpl, cur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(p.clicks)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(p.impressions)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
