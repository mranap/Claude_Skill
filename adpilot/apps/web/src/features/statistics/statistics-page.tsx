'use client';

import type { MetricsDto } from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartColumn, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import {
  DataTable,
  DataTableToolbar,
  FilterSelect,
  useUrlTableState,
  type DataTableColumn,
  type TableController,
} from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { CooldownButton } from '@/components/product/cooldown-button';
import { EffectiveStatusBadge } from '@/components/product/status';
import {
  parseStatsRange,
  statsRangeLabel,
  statsRangeParams,
  statsRangePatch,
  StatsRangePicker,
} from '@/components/product/stats-range-picker';
import { getErrorMessage } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useCooldown } from '@/lib/hooks/use-cooldown';
import { formatDateTime } from '@/lib/utils/format';
import { useConnectedAdAccounts } from '../ad-accounts/api';
import type { AdAccountDto } from '../ad-accounts/types';
import { statisticsApi, useStatistics } from './api';
import { formatMetric, METRICS, metricColumns, type MetricKey } from './metrics';
import { SeriesCard } from './series-card';
import type { StatsLevel, StatsRefreshResponse, StatsRow, StatsSyncInfo } from './types';

const SORTABLE = [
  'spend',
  'impressions',
  'clicks',
  'linkClicks',
  'ctr',
  'cpc',
  'cpm',
  'leads',
  'cpl',
  'purchases',
  'roas',
  'results',
  'costPerResult',
] as const;
const TABLE_METRICS: MetricKey[] = [
  'spend',
  'impressions',
  'linkClicks',
  'ctr',
  'cpc',
  'cpm',
  'leads',
  'cpl',
  'purchases',
  'roas',
  'results',
  'costPerResult',
];
const TOTAL_METRICS: MetricKey[] = [
  'spend',
  'impressions',
  'linkClicks',
  'ctr',
  'cpc',
  'cpm',
  'leads',
  'cpl',
  'purchases',
  'roas',
];
const LEVEL_LABELS: Record<StatsLevel, string> = { CAMPAIGN: 'Campaign', ADSET: 'Ad set', AD: 'Ad' };
const LEVEL_PLURAL: Record<StatsLevel, string> = { CAMPAIGN: 'campaigns', ADSET: 'ad sets', AD: 'ads' };

function useRefreshStatistics(cooldown: ReturnType<typeof useCooldown>, adAccountId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => statisticsApi.refresh(adAccountId),
    onSuccess: (res: StatsRefreshResponse) => {
      const queued = res.results.filter((r) => r.queued).length;
      const waits = res.results.filter((r) => !r.queued).map((r) => r.retryAfterSeconds ?? 60);
      // Every account is now on cooldown: the button is useful again when the earliest one expires.
      const next = Math.min(queued ? res.cooldownMinutes * 60 : Infinity, ...waits);
      if (Number.isFinite(next)) cooldown.start(next);
      if (queued) {
        toast.success(`Refreshing statistics for ${queued} ad account${queued === 1 ? '' : 's'}`, {
          description: waits.length
            ? `${waits.length} refreshed recently and ${waits.length === 1 ? 'was' : 'were'} skipped.`
            : 'New numbers appear here as soon as Meta returns them.',
        });
      } else {
        toast.info('Statistics were refreshed recently', {
          description: `You can refresh again in ${Math.ceil(Math.min(...waits) / 60)} min.`,
        });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.statistics.all });
    },
    onError: (error) => {
      if (!cooldown.fromError(error))
        toast.error('Could not refresh statistics', { description: getErrorMessage(error) });
    },
  });
}

export function StatisticsPage() {
  const table = useUrlTableState({ filterKeys: ['level', 'range', 'from', 'to', 'adAccountId'] });
  const state = useMemo<TableController>(
    () => ({
      ...table,
      hasActiveFilters: !!table.q || !!table.filters.adAccountId,
      reset: () => table.setFilters({ q: undefined, adAccountId: undefined }),
    }),
    [table],
  );
  const level = (
    ['ADSET', 'AD'].includes(table.filters.level ?? '') ? table.filters.level : 'CAMPAIGN'
  ) as StatsLevel;
  const range = parseStatsRange(table.filters.range, table.filters.from, table.filters.to, 'last_7d');
  const adAccountId = table.filters.adAccountId;

  const params: Record<string, string | number> = {
    level,
    page: table.page,
    pageSize: table.pageSize,
    ...statsRangeParams(range),
  };
  if (table.q) params.q = table.q;
  if (table.sort) params.sort = table.sort;
  if (adAccountId) params.adAccountId = adAccountId;
  const stats = useStatistics(params, { poll: true });
  const accounts = useConnectedAdAccounts();
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const cooldown = useCooldown();
  const refresh = useRefreshStatistics(cooldown, adAccountId);
  const data = stats.data;
  // "Refresh" is refused only while every account in view is on cooldown: count down to the earliest one.
  const { start } = cooldown;
  const nextRefreshAt = (data?.sync ?? []).reduce(
    (min, s) => Math.min(min, s.nextManualRefreshAt ? new Date(s.nextManualRefreshAt).getTime() : 0),
    Infinity,
  );
  useEffect(() => {
    if (Number.isFinite(nextRefreshAt) && nextRefreshAt > Date.now())
      start(Math.ceil((nextRefreshAt - Date.now()) / 1000));
  }, [nextRefreshAt, start]);
  const zones = [
    ...new Set((data?.sync ?? []).map((s) => accountById.get(s.adAccountId)?.timezoneName).filter(Boolean)),
  ] as string[];
  const otherCurrencies = (data?.totals ?? [])
    .map((t) => t.currency)
    .filter((c) => c !== data?.primaryCurrency);

  const columns: DataTableColumn<StatsRow>[] = [
    {
      id: 'name',
      header: LEVEL_LABELS[level],
      interactive: true,
      cell: (r) => {
        const href = !r.entity
          ? null
          : level === 'CAMPAIGN'
            ? `/campaigns/${r.entity.id}`
            : r.entity.campaignId
              ? `/campaigns/${r.entity.campaignId}?${level === 'ADSET' ? 'adset' : 'ad'}=${r.entity.id}`
              : null;
        return (
          <div className="grid min-w-0 max-w-[22rem] gap-0.5">
            {href ? (
              <Link href={href} className="truncate font-medium hover:underline">
                {r.name ?? r.metaObjectId}
              </Link>
            ) : (
              <span className="truncate font-medium">{r.name ?? r.metaObjectId}</span>
            )}
            <span className="truncate font-mono text-xs text-muted-foreground">{r.metaObjectId}</span>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Delivery',
      cell: (r) =>
        r.entity ? (
          <EffectiveStatusBadge status={r.entity.effectiveStatus} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'account',
      header: 'Ad account',
      cell: (r) => (
        <div className="grid min-w-0 max-w-[14rem] gap-0.5">
          <span className="truncate">{r.adAccountName ?? '—'}</span>
          <span className="text-xs text-muted-foreground">
            {r.metrics.currency}
            {accountById.get(r.adAccountId) ? ` · ${accountById.get(r.adAccountId)!.timezoneName}` : ''}
          </span>
        </div>
      ),
    },
    ...metricColumns<StatsRow>(TABLE_METRICS, (r) => r.metrics, SORTABLE),
  ];

  return (
    <>
      <PageHeader
        title="Statistics"
        description="Meta Insights synced for your connected ad accounts. Ranges are evaluated in each ad account's own time zone, and amounts are never converted between currencies."
        actions={
          <CooldownButton
            cooldown={cooldown}
            variant="outline"
            onClick={() => refresh.mutate()}
            loading={refresh.isPending}
            cooldownHint="Statistics can be refreshed manually once per cooldown period"
          >
            <RefreshCw />
            {adAccountId ? 'Refresh account' : 'Refresh all'}
          </CooldownButton>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Level"
          value={level}
          onValueChange={(next) =>
            table.setFilters({ level: next === 'CAMPAIGN' ? undefined : next, sort: undefined })
          }
          options={[
            { value: 'CAMPAIGN', label: 'Campaigns' },
            { value: 'ADSET', label: 'Ad sets' },
            { value: 'AD', label: 'Ads' },
          ]}
        />
        <StatsRangePicker value={range} onChange={(next) => table.setFilters(statsRangePatch(next))} />
        {(accounts.data?.length ?? 0) > 1 ? (
          <FilterSelect
            state={state}
            filterKey="adAccountId"
            allLabel="All ad accounts"
            options={(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
          />
        ) : null}
        <span className="text-xs text-muted-foreground">
          {statsRangeLabel(range)}
          {zones.length
            ? ` · ${zones.length === 1 ? `time zone ${zones[0]}` : `time zones ${zones.join(', ')}`}`
            : ''}
        </span>
      </div>

      <section aria-label="Totals" className="mb-4 grid gap-3">
        {stats.isLoading && !data ? (
          <Skeleton className="h-28 w-full rounded-lg" />
        ) : data?.totals.length ? (
          data.totals.map((t) => <TotalsCard key={t.currency} totals={t} />)
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No delivery in this period.
            </CardContent>
          </Card>
        )}
      </section>

      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        <SeriesCard
          className="xl:col-span-2"
          series={data?.series}
          currency={data?.primaryCurrency}
          loading={stats.isLoading}
          fetching={stats.isFetching && !stats.isLoading}
          description={
            <>
              Per day in {data?.primaryCurrency ?? '…'}
              {otherCurrencies.length
                ? ` (the currency with the highest spend; ${otherCurrencies.join(', ')} totals are shown above)`
                : ''}
              .
            </>
          }
        />
        <SyncCard sync={data?.sync} accounts={accountById} loading={stats.isLoading} />
      </div>

      <DataTable
        aria-label="Statistics"
        columns={columns}
        data={data?.items}
        total={data?.total}
        state={state}
        getRowId={(r) => r.metaObjectId}
        isLoading={stats.isLoading}
        isFetching={stats.isFetching}
        error={stats.error}
        onRetry={() => void stats.refetch()}
        minWidth={1560}
        toolbar={
          <DataTableToolbar
            state={state}
            searchPlaceholder={`Search ${LEVEL_LABELS[level].toLowerCase()} name or ID`}
          />
        }
        emptyState={
          <EmptyState
            compact
            icon={ChartColumn}
            title={
              state.hasActiveFilters
                ? 'Nothing matches the search'
                : `No ${LEVEL_PLURAL[level]} with delivery in this period`
            }
            description="Only objects with delivery in the selected period are listed. Try a longer range or refresh the statistics."
          />
        }
      />
    </>
  );
}

function TotalsCard({ totals }: { totals: MetricsDto }) {
  return (
    <Card className="gap-0 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">Totals in {totals.currency}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 xl:grid-cols-10">
        {TOTAL_METRICS.map((key) => (
          <div key={key} className="grid min-w-0 gap-0.5">
            <dt className="truncate text-xs text-muted-foreground">{METRICS[key].label}</dt>
            <dd className="truncate text-base font-semibold tabular-nums">{formatMetric(totals, key)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const SYNC_TONES: Record<string, 'success' | 'danger' | 'info' | 'muted'> = {
  SUCCESS: 'success',
  FAILED: 'danger',
  QUEUED: 'info',
  RUNNING: 'info',
  IDLE: 'muted',
};

function SyncCard({
  sync,
  accounts,
  loading,
}: {
  sync: StatsSyncInfo[] | undefined;
  accounts: Map<string, AdAccountDto>;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync status</CardTitle>
        <CardDescription>
          Statistics are synced automatically; refresh an account to fetch the latest numbers now.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        {loading && !sync ? <Skeleton className="h-24 w-full" /> : null}
        {sync?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connected ad accounts.</p>
        ) : null}
        {sync?.map((s) => (
          <SyncRow key={s.adAccountId} sync={s} account={accounts.get(s.adAccountId)} />
        ))}
      </CardContent>
    </Card>
  );
}

function SyncRow({ sync, account }: { sync: StatsSyncInfo; account: AdAccountDto | undefined }) {
  const cooldown = useCooldown();
  const refresh = useRefreshStatistics(cooldown, sync.adAccountId);
  const tz = account?.timezoneName;
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2.5 last:border-b-0">
      <div className="grid min-w-0 gap-0.5">
        <Link
          href={`/ad-accounts/${sync.adAccountId}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {sync.name}
        </Link>
        <span className="text-xs text-muted-foreground">{account ? `${account.currency} · ${tz}` : '—'}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <StatusBadge status={sync.status} tone={SYNC_TONES[sync.status] ?? 'muted'} size="sm" />
          {sync.lastStatsSyncAt ? (
            <SimpleTooltip content={tz ? `${formatDateTime(sync.lastStatsSyncAt)} (your time)` : undefined}>
              <span>
                synced <RelativeTime value={sync.lastStatsSyncAt} />
              </span>
            </SimpleTooltip>
          ) : (
            'never synced'
          )}
        </span>
        {sync.status === 'FAILED' && account?.statsSyncError ? (
          <span className="text-xs text-destructive-fg">{account.statsSyncError}</span>
        ) : null}
      </div>
      <CooldownButton
        cooldown={cooldown}
        size="xs"
        variant="ghost"
        onClick={() => refresh.mutate()}
        loading={refresh.isPending}
        aria-label={`Refresh ${sync.name}`}
      >
        <RefreshCw />
        Refresh
      </CooldownButton>
    </div>
  );
}
