'use client';

import { objectiveRule } from '@adpilot/shared';
import { ExternalLink, Megaphone, Pause, Play, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DataTable,
  DataTableToolbar,
  FilterSelect,
  useUrlTableState,
  type DataTableColumn,
  type TableController,
} from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { EFFECTIVE_STATUS_OPTIONS, EffectiveStatusBadge } from '@/components/product/status';
import { parseStatsRange, statsRangeParams, statsRangePatch, StatsRangePicker, type StatsRange } from '@/components/product/stats-range-picker';
import { useAuth } from '@/features/auth/auth-context';
import { countryOptions, describeCountries } from '@/lib/utils/countries';
import { minorToDecimal } from '@/lib/utils/money';
import { humanize } from '@/lib/utils/strings';
import { READ_ACCESS } from '@/lib/permissions';
import { useConnectedAdAccounts } from '../ad-accounts/api';
import { useStatistics } from '../statistics/api';
import { formatMetric, metricColumns } from '../statistics/metrics';
import type { StatsLevel, StatsRow } from '../statistics/types';
import { useTemplates } from '../templates/api';
import { useCampaign, useCampaigns } from './api';
import {
  BudgetCell,
  BulkOperationBanner,
  BulkStatusDialog,
  LEVEL_LABEL,
  StatusToggle,
  type BulkRequest,
} from './entity-actions';
import type { BudgetDto, BulkOperationDto, CampaignListItem, EntityActionLevel } from './types';

const FILTER_KEYS = ['adAccountId', 'status', 'templateId', 'country'] as const;
const CAMPAIGN_SORT = ['spend', 'leads', 'cpl', 'ctr', 'cpc', 'impressions'] as const;
const STATS_SORT = ['spend', 'impressions', 'linkClicks', 'ctr', 'cpc', 'leads', 'cpl'] as const;
const ALL = '__all__';

export function objectiveLabel(objective: string | null | undefined): string {
  if (!objective) return '—';
  return objectiveRule(objective)?.label ?? humanize(objective.replace(/^OUTCOME_/, ''));
}

/** Budget of a statistics row entity (minor units) → BudgetDto in major units. */
function entityBudget(row: StatsRow): BudgetDto | null {
  const daily = row.entity?.dailyBudget;
  const lifetime = row.entity?.lifetimeBudget;
  const currency = row.metrics.currency;
  if (daily && daily !== '0') return { type: 'DAILY', amount: minorToDecimal(daily, currency) ?? '0' };
  if (lifetime && lifetime !== '0') return { type: 'LIFETIME', amount: minorToDecimal(lifetime, currency) ?? '0' };
  return null;
}

/** Search/filters exclude the level and the date range, which are view settings rather than filters. */
function useFilterController(table: TableController): TableController {
  return useMemo(
    () => ({
      ...table,
      hasActiveFilters: !!table.q || FILTER_KEYS.some((k) => !!table.filters[k]),
      reset: () => table.setFilters({ q: undefined, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) }),
    }),
    [table],
  );
}

export function CampaignsPage() {
  const { can } = useAuth();
  const canManage = can('app.campaigns.manage');
  const table = useUrlTableState({ filterKeys: ['level', 'range', 'from', 'to', ...FILTER_KEYS] });
  const state = useFilterController(table);
  const level = (['ADSET', 'AD'].includes(table.filters.level ?? '') ? table.filters.level : 'CAMPAIGN') as StatsLevel;
  const range = parseStatsRange(table.filters.range, table.filters.from, table.filters.to, 'today');
  const [bulkRequest, setBulkRequest] = useState<BulkRequest | null>(null);
  const [operation, setOperation] = useState<BulkOperationDto | null>(null);

  const setLevel = (next: StatsLevel) =>
    table.setFilters({ level: next === 'CAMPAIGN' ? undefined : next, sort: undefined, status: undefined, templateId: undefined, country: undefined });
  const setRange = (next: StatsRange) => table.setFilters(statsRangePatch(next));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Campaigns, ad sets and ads of your connected ad accounts. Numbers use each ad account's currency and time zone."
        actions={
          can('app.campaigns.launch') ? (
            <Button asChild>
              <Link href="/launch">
                <Rocket />
                New launch
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Level"
          value={level}
          onValueChange={setLevel}
          options={[
            { value: 'CAMPAIGN', label: 'Campaigns' },
            { value: 'ADSET', label: 'Ad sets' },
            { value: 'AD', label: 'Ads' },
          ]}
        />
        <StatsRangePicker value={range} onChange={setRange} />
      </div>
      {operation ? <BulkOperationBanner key={operation.id} operation={operation} onDismiss={() => setOperation(null)} className="mb-3" /> : null}
      {level === 'CAMPAIGN' ? (
        <CampaignTable state={state} range={range} canManage={canManage} onBulk={setBulkRequest} />
      ) : (
        <ObjectTable level={level} state={state} range={range} canManage={canManage} onBulk={setBulkRequest} />
      )}
      {bulkRequest ? (
        <BulkStatusDialog
          request={bulkRequest}
          onClose={() => setBulkRequest(null)}
          onStarted={(op) => {
            setOperation(op);
            setBulkRequest(null);
          }}
        />
      ) : null}
    </>
  );
}

function BulkButtons({ level, selected, onBulk, clear }: { level: EntityActionLevel; selected: { id: string; name: string }[]; onBulk: (r: BulkRequest) => void; clear: () => void }) {
  const run = (status: 'ACTIVE' | 'PAUSED') => {
    onBulk({ level, status, targets: selected });
    clear();
  };
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => run('PAUSED')}>
        <Pause />
        Pause
      </Button>
      <Button size="xs" variant="outline" onClick={() => run('ACTIVE')}>
        <Play />
        Start
      </Button>
    </>
  );
}

function AccountFilter({ state }: { state: TableController }) {
  const accounts = useConnectedAdAccounts();
  if ((accounts.data?.length ?? 0) < 2) return null;
  return (
    <FilterSelect
      state={state}
      filterKey="adAccountId"
      allLabel="All ad accounts"
      options={(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
    />
  );
}

function CountryFilter({ state }: { state: TableController }) {
  const options = useMemo(() => [{ value: ALL, label: 'Any country' }, ...countryOptions().map((c) => ({ value: c.code, label: c.name, hint: c.code, keywords: [c.code] }))], []);
  return (
    <Combobox
      value={state.filters.country ?? ALL}
      onValueChange={(v) => state.setFilter('country', v === ALL ? undefined : v)}
      options={options}
      searchPlaceholder="Search countries"
      className="h-8 w-auto min-w-36 text-[13px]"
    />
  );
}

// ───────────── Campaign level ─────────────

function CampaignTable({
  state,
  range,
  canManage,
  onBulk,
}: {
  state: TableController;
  range: StatsRange;
  canManage: boolean;
  onBulk: (r: BulkRequest) => void;
}) {
  const params: Record<string, string | number> = { page: state.page, pageSize: state.pageSize, ...statsRangeParams(range) };
  if (state.q) params.q = state.q;
  if (state.sort) params.sort = state.sort;
  for (const key of FILTER_KEYS) if (state.filters[key]) params[key] = state.filters[key]!;
  const campaigns = useCampaigns(params);
  const { canAny } = useAuth();
  const templates = useTemplates({ pageSize: 100, sort: 'name:asc' }, canAny(READ_ACCESS.templates));

  const columns: DataTableColumn<CampaignListItem>[] = [
    {
      id: 'name',
      header: 'Campaign',
      sortField: 'name',
      interactive: true,
      cell: (c) => (
        <div className="grid min-w-0 max-w-[22rem] gap-0.5">
          <Link href={`/campaigns/${c.id}`} className="truncate font-medium hover:underline">
            {c.name}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {objectiveLabel(c.objective)} · <span className="font-mono">{c.metaCampaignId}</span>
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Delivery',
      interactive: true,
      cell: (c) => (
        <div className="flex items-center gap-2">
          <StatusToggle entity={{ level: 'CAMPAIGN', id: c.id, name: c.name, status: c.status, currency: c.currency }} canManage={canManage} />
          <EffectiveStatusBadge status={c.effectiveStatus} />
        </div>
      ),
    },
    {
      id: 'budget',
      header: 'Budget',
      align: 'right',
      interactive: true,
      cell: (c) => <BudgetCell entity={{ level: 'CAMPAIGN', id: c.id, name: c.name, status: c.status, currency: c.currency, budget: c.budget }} canManage={canManage} />,
    },
    {
      id: 'account',
      header: 'Ad account',
      cell: (c) => (
        <div className="grid min-w-0 max-w-[14rem] gap-0.5">
          <span className="truncate">{c.adAccount.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {c.currency} · {describeCountries(c.countries)}
          </span>
        </div>
      ),
    },
    ...metricColumns<CampaignListItem>(['spend', 'leads', 'cpl', 'ctr', 'cpc', 'impressions'], (c) => c.metrics, CAMPAIGN_SORT),
    {
      id: 'updated',
      header: 'Updated',
      sortField: 'updatedAt',
      cell: (c) => <RelativeTime value={c.updatedAt} className="text-muted-foreground" />,
    },
  ];

  return (
    <DataTable
      aria-label="Campaigns"
      columns={columns}
      data={campaigns.data?.items}
      total={campaigns.data?.total}
      state={state}
      getRowId={(c) => c.id}
      isLoading={campaigns.isLoading}
      isFetching={campaigns.isFetching}
      error={campaigns.error}
      onRetry={() => void campaigns.refetch()}
      selectable={canManage}
      bulkActions={({ selected, clear }) => (
        <BulkButtons level="CAMPAIGN" selected={selected.map((c) => ({ id: c.id, name: c.name }))} onBulk={onBulk} clear={clear} />
      )}
      renderExpanded={(c) => <CampaignChildren campaign={c} range={range} canManage={canManage} />}
      minWidth={1320}
      toolbar={
        <DataTableToolbar
          state={state}
          searchPlaceholder="Search name or campaign ID"
          filters={
            <>
              <AccountFilter state={state} />
              <FilterSelect state={state} filterKey="status" allLabel="Any delivery" options={EFFECTIVE_STATUS_OPTIONS} aria-label="Delivery status" />
              {(templates.data?.items.length ?? 0) > 0 ? (
                <FilterSelect state={state} filterKey="templateId" allLabel="Any template" options={(templates.data?.items ?? []).map((t) => ({ value: t.id, label: t.name }))} />
              ) : null}
              <CountryFilter state={state} />
            </>
          }
        />
      }
      emptyState={
        state.hasActiveFilters ? (
          <EmptyState compact icon={Megaphone} title="No campaigns match the filters" action={<Button variant="outline" size="sm" onClick={state.reset}>Reset filters</Button>} />
        ) : (
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="Campaigns of your connected ad accounts appear here after the next sync, and campaigns you launch from AdPilot right away."
            action={
              <Button asChild>
                <Link href="/launch">
                  <Rocket />
                  Launch a campaign
                </Link>
              </Button>
            }
          />
        )
      }
    />
  );
}

/** Expanded campaign row: its ad sets and their ads (from the campaign detail). */
function CampaignChildren({ campaign, range, canManage }: { campaign: CampaignListItem; range: StatsRange; canManage: boolean }) {
  const detail = useCampaign(campaign.id, statsRangeParams(range));
  if (detail.isLoading) {
    return (
      <div className="grid gap-2 py-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-4/5" />
      </div>
    );
  }
  if (detail.error) return <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} />;
  const data = detail.data;
  if (!data) return null;
  return (
    <div className="grid gap-2 pt-1">
      {data.adSets.length === 0 ? <p className="py-2 text-sm text-muted-foreground">This campaign has no ad sets.</p> : null}
      {data.adSets.map((set) => {
        const ads = data.ads.filter((a) => a.adSetId === set.id);
        return (
          <div key={set.id} className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
              <div className="grid w-72 min-w-0 gap-0.5">
                <span className="text-xs text-muted-foreground">Ad set</span>
                <Link href={`/campaigns/${campaign.id}?adset=${set.id}`} className="truncate text-sm font-medium hover:underline">
                  {set.name}
                </Link>
              </div>
              <div className="flex w-44 items-center gap-2">
                <StatusToggle entity={{ level: 'ADSET', id: set.id, name: set.name, status: set.status, currency: data.currency }} canManage={canManage} />
                <EffectiveStatusBadge status={set.effectiveStatus} size="sm" />
              </div>
              <div className="w-28">
                <BudgetCell entity={{ level: 'ADSET', id: set.id, name: set.name, status: set.status, currency: data.currency, budget: set.budget }} canManage={canManage} />
              </div>
              <ChildMetrics metrics={set.metrics} />
            </div>
            {ads.length ? (
              <ul className="border-t">
                {ads.map((ad) => (
                  <li key={ad.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 pl-6 last:border-b-0">
                    <div className="grid w-[16.75rem] min-w-0 gap-0.5">
                      <span className="text-xs text-muted-foreground">Ad</span>
                      <Link href={`/campaigns/${campaign.id}?ad=${ad.id}`} className="truncate text-sm hover:underline">
                        {ad.name}
                      </Link>
                    </div>
                    <div className="flex w-44 items-center gap-2">
                      <StatusToggle entity={{ level: 'AD', id: ad.id, name: ad.name, status: ad.status, currency: data.currency }} canManage={canManage} />
                      <EffectiveStatusBadge status={ad.effectiveStatus} size="sm" />
                    </div>
                    <div className="w-28" />
                    <ChildMetrics metrics={ad.metrics} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      <div>
        <Button variant="link" size="sm" asChild>
          <Link href={`/campaigns/${campaign.id}`}>
            Open campaign
            <ExternalLink />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ChildMetrics({ metrics }: { metrics: CampaignListItem['metrics'] }) {
  if (!metrics) return <span className="w-40 text-xs text-muted-foreground">No delivery in this period</span>;
  return (
    <dl className="grid w-40 grid-cols-[auto_1fr] gap-x-3 text-xs tabular-nums">
      <dt className="text-muted-foreground">Spend</dt>
      <dd>{formatMetric(metrics, 'spend')}</dd>
      <dt className="text-muted-foreground">Leads</dt>
      <dd>{formatMetric(metrics, 'leads')}</dd>
    </dl>
  );
}

// ───────────── Ad set / ad level (objects with delivery in the range) ─────────────

function ObjectTable({
  level,
  state,
  range,
  canManage,
  onBulk,
}: {
  level: 'ADSET' | 'AD';
  state: TableController;
  range: StatsRange;
  canManage: boolean;
  onBulk: (r: BulkRequest) => void;
}) {
  const params: Record<string, string | number> = { level, page: state.page, pageSize: state.pageSize, ...statsRangeParams(range) };
  if (state.q) params.q = state.q;
  if (state.sort) params.sort = state.sort;
  if (state.filters.adAccountId) params.adAccountId = state.filters.adAccountId;
  const rows = useStatistics(params);
  const label = LEVEL_LABEL[level];

  const columns: DataTableColumn<StatsRow>[] = [
    {
      id: 'name',
      header: label.title,
      interactive: true,
      cell: (r) => {
        const href = r.entity?.campaignId ? `/campaigns/${r.entity.campaignId}?${level === 'ADSET' ? 'adset' : 'ad'}=${r.entity.id}` : null;
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
      interactive: true,
      cell: (r) =>
        r.entity ? (
          <div className="flex items-center gap-2">
            <StatusToggle entity={{ level, id: r.entity.id, name: r.name ?? r.metaObjectId, status: r.entity.status, currency: r.metrics.currency }} canManage={canManage} />
            <EffectiveStatusBadge status={r.entity.effectiveStatus} />
          </div>
        ) : (
          <Badge variant="muted">Not synced</Badge>
        ),
    },
    ...(level === 'ADSET'
      ? [
          {
            id: 'budget',
            header: 'Budget',
            align: 'right' as const,
            interactive: true,
            cell: (r: StatsRow) =>
              r.entity ? (
                <BudgetCell
                  entity={{ level: 'ADSET', id: r.entity.id, name: r.name ?? r.metaObjectId, status: r.entity.status, currency: r.metrics.currency, budget: entityBudget(r) }}
                  canManage={canManage}
                />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]
      : []),
    {
      id: 'account',
      header: 'Ad account',
      cell: (r) => (
        <div className="grid min-w-0 max-w-[14rem] gap-0.5">
          <span className="truncate">{r.adAccountName ?? '—'}</span>
          <span className="text-xs text-muted-foreground">{r.metrics.currency}</span>
        </div>
      ),
    },
    ...metricColumns<StatsRow>(['spend', 'leads', 'cpl', 'ctr', 'cpc', 'impressions'], (r) => r.metrics, STATS_SORT),
  ];

  return (
    <DataTable
      aria-label={label.many}
      columns={columns}
      data={rows.data?.items}
      total={rows.data?.total}
      state={state}
      getRowId={(r) => r.metaObjectId}
      isLoading={rows.isLoading}
      isFetching={rows.isFetching}
      error={rows.error}
      onRetry={() => void rows.refetch()}
      selectable={canManage}
      isRowSelectable={(r) => !!r.entity}
      bulkActions={({ selected, clear }) => (
        <BulkButtons level={level} selected={selected.filter((r) => r.entity).map((r) => ({ id: r.entity!.id, name: r.name ?? r.metaObjectId }))} onBulk={onBulk} clear={clear} />
      )}
      minWidth={1180}
      toolbar={
        <div className="grid gap-2">
          <DataTableToolbar state={state} searchPlaceholder={`Search ${label.one} name or ID`} filters={<AccountFilter state={state} />} />
          <p className="text-xs text-muted-foreground">
            Lists {label.many} with delivery in the selected period. Open a campaign to see all of its {label.many}, including those without delivery.
          </p>
        </div>
      }
      emptyState={
        <EmptyState
          compact
          icon={Megaphone}
          title={`No ${label.many} with delivery in this period`}
          description={`Pick a longer date range, or open a campaign to manage ${label.many} that have not delivered yet.`}
        />
      }
    />
  );
}
