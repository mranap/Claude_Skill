'use client';

import { Ellipsis, ExternalLink, LayoutTemplate, Pause, Play, Rocket, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatCard } from '@/components/shared/stat-card';
import { MetaId } from '@/components/product/meta-id';
import { EffectiveStatusBadge } from '@/components/product/status';
import {
  parseStatsRange,
  statsRangeLabel,
  statsRangeParams,
  StatsRangePicker,
  type StatsRange,
} from '@/components/product/stats-range-picker';
import { useAuth } from '@/features/auth/auth-context';
import { countryName } from '@/lib/utils/countries';
import { cn } from '@/lib/utils/cn';
import { formatAmount } from '@/lib/utils/money';
import { READ_ACCESS } from '@/lib/permissions';
import { humanize } from '@/lib/utils/strings';
import { ActivityTimeline } from '../activity/activity-timeline';
import { formatMetric, metricColumns } from '../statistics/metrics';
import { useCampaign } from './api';
import { objectiveLabel } from './campaigns-page';
import {
  BudgetCell,
  BudgetDialog,
  BulkOperationBanner,
  BulkStatusDialog,
  StatusToggle,
  type BulkRequest,
} from './entity-actions';
import type { AdRow, AdSetRow, BulkOperationDto, CampaignDetail, EntityActionLevel } from './types';

/** Flattens Meta's `issues_info` / `ad_review_feedback` JSON into readable lines. */
export function metaMessages(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          return String(o.error_summary ?? o.error_message ?? o.message ?? JSON.stringify(o));
        }
        return String(item);
      })
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    const out: string[] = [];
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [reason, text] of Object.entries(v as Record<string, unknown>))
          out.push(`${humanize(reason)}: ${String(text)}`);
      } else out.push(`${humanize(key)}: ${String(v)}`);
    }
    return out;
  }
  return [String(value)];
}

export function CampaignDetailPage({ id }: { id: string }) {
  const [range, setRange] = useState<StatsRange>(() => parseStatsRange('last_7d', null, null, 'last_7d'));
  const campaign = useCampaign(id, statsRangeParams(range));

  if (campaign.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-96 max-w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (campaign.isError || !campaign.data) {
    return (
      <>
        <PageHeader
          title="Campaign"
          breadcrumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: 'Not available' }]}
        />
        <ErrorAlert error={campaign.error} onRetry={() => void campaign.refetch()} />
      </>
    );
  }
  return (
    <CampaignView
      campaign={campaign.data}
      range={range}
      onRangeChange={setRange}
      fetching={campaign.isFetching}
    />
  );
}

function CampaignView({
  campaign,
  range,
  onRangeChange,
  fetching,
}: {
  campaign: CampaignDetail;
  range: StatsRange;
  onRangeChange: (r: StatsRange) => void;
  fetching: boolean;
}) {
  const { can, canAny } = useAuth();
  const canManage = can('app.campaigns.manage');
  const searchParams = useSearchParams();
  const focusAdSet = searchParams.get('adset');
  const focusAd = searchParams.get('ad');
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [bulkRequest, setBulkRequest] = useState<BulkRequest | null>(null);
  const [operation, setOperation] = useState<BulkOperationDto | null>(null);
  const currency = campaign.currency;
  const tz = campaign.adAccount.timezoneName;
  const metrics = campaign.metrics;
  const issues = metaMessages(campaign.issuesInfo);
  const entity = {
    level: 'CAMPAIGN' as const,
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    currency,
    budget: campaign.budget,
  };
  const adSetName = new Map(campaign.adSets.map((s) => [s.id, s.name]));

  // Deep links from search (?adset= / ?ad=) scroll to the matching row.
  const focusId = focusAd ?? focusAdSet;
  useEffect(() => {
    if (!focusId) return;
    const el = document.querySelector(`[data-row-id="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId]);

  const bulkButtons = (
    level: EntityActionLevel,
    selected: { id: string; name: string }[],
    clear: () => void,
  ) => (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          setBulkRequest({ level, status: 'PAUSED', targets: selected });
          clear();
        }}
      >
        <Pause />
        Pause
      </Button>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          setBulkRequest({ level, status: 'ACTIVE', targets: selected });
          clear();
        }}
      >
        <Play />
        Start
      </Button>
    </>
  );

  const adSetColumns: DataTableColumn<AdSetRow>[] = [
    {
      id: 'name',
      header: 'Ad set',
      cell: (s) => (
        <div className="grid min-w-0 max-w-[20rem] gap-0.5" data-row-id={s.id}>
          <span className="truncate font-medium">{s.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{s.metaAdSetId}</span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Delivery',
      interactive: true,
      cell: (s) => (
        <div className="flex items-center gap-2">
          <StatusToggle
            entity={{ level: 'ADSET', id: s.id, name: s.name, status: s.status, currency }}
            canManage={canManage}
          />
          <EffectiveStatusBadge status={s.effectiveStatus} />
        </div>
      ),
    },
    {
      id: 'budget',
      header: 'Budget',
      align: 'right',
      interactive: true,
      cell: (s) => (
        <BudgetCell
          entity={{ level: 'ADSET', id: s.id, name: s.name, status: s.status, currency, budget: s.budget }}
          canManage={canManage}
        />
      ),
    },
    {
      id: 'goal',
      header: 'Optimisation',
      cell: (s) => (
        <div className="grid gap-0.5">
          <span>{s.optimizationGoal ? humanize(s.optimizationGoal) : '—'}</span>
          <span className="text-xs text-muted-foreground">
            {s.countries.length ? s.countries.map(countryName).join(', ') : 'No countries'}
          </span>
        </div>
      ),
    },
    ...metricColumns<AdSetRow>(['spend', 'leads', 'cpl', 'ctr', 'cpc', 'impressions'], (s) => s.metrics),
  ];

  const adColumns: DataTableColumn<AdRow>[] = [
    {
      id: 'name',
      header: 'Ad',
      cell: (a) => {
        const feedback = [...metaMessages(a.reviewFeedback), ...metaMessages(a.issuesInfo)];
        return (
          <div className="grid min-w-0 max-w-[22rem] gap-0.5" data-row-id={a.id}>
            <span className="truncate font-medium">{a.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {adSetName.get(a.adSetId) ?? 'Ad set'} · <span className="font-mono">{a.metaAdId}</span>
            </span>
            {feedback.length ? (
              <ul className="mt-1 grid gap-0.5 text-xs text-destructive-fg">
                {feedback.slice(0, 3).map((f, i) => (
                  <li key={i} className="flex gap-1">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span className="whitespace-normal">{f}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Delivery',
      interactive: true,
      cell: (a) => (
        <div className="flex items-center gap-2">
          <StatusToggle
            entity={{ level: 'AD', id: a.id, name: a.name, status: a.status, currency }}
            canManage={canManage}
          />
          <EffectiveStatusBadge status={a.effectiveStatus} />
        </div>
      ),
    },
    ...metricColumns<AdRow>(['spend', 'leads', 'cpl', 'ctr', 'cpc', 'impressions'], (a) => a.metrics),
  ];

  const noDelivery = !metrics;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: campaign.name }]}
        title={<span className="break-all">{campaign.name}</span>}
        meta={<EffectiveStatusBadge status={campaign.effectiveStatus} />}
        description={
          <>
            {objectiveLabel(campaign.objective)} ·{' '}
            <Link href={`/ad-accounts/${campaign.adAccount.id}`} className="hover:underline">
              {campaign.adAccount.name}
            </Link>{' '}
            · {currency} · {tz}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center gap-2 rounded-md border bg-field px-3 text-sm">
              <StatusToggle entity={entity} canManage={canManage} />
              {campaign.status === 'ACTIVE'
                ? 'Active'
                : campaign.status === 'PAUSED'
                  ? 'Paused'
                  : humanize(campaign.status ?? 'Unknown')}
            </span>
            {campaign.budget && canManage ? (
              <Button variant="outline" onClick={() => setBudgetOpen(true)}>
                Edit budget
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <a
                    href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${campaign.adAccount.metaAccountId}&selected_campaign_ids=${campaign.metaCampaignId}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <ExternalLink />
                    Open in Ads Manager
                  </a>
                </DropdownMenuItem>
                {campaign.launchJobId && can('app.campaigns.launch') ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/launches/${campaign.launchJobId}`}>
                      <Rocket />
                      Launch details
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {campaign.templateId && canAny(READ_ACCESS.templates) ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/templates/${campaign.templateId}`}>
                      <LayoutTemplate />
                      Template
                    </Link>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {campaign.budget ? (
        <BudgetDialog entity={entity} open={budgetOpen} onOpenChange={setBudgetOpen} />
      ) : null}

      {issues.length ? (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Meta reports issues with this campaign</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {issues.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {operation ? (
        <BulkOperationBanner
          key={operation.id}
          operation={operation}
          onDismiss={() => setOperation(null)}
          className="mb-4"
        />
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatsRangePicker value={range} onChange={onRangeChange} />
        <span className="text-xs text-muted-foreground">
          {statsRangeLabel(range)} in the ad account time zone ({tz}){fetching ? ' · updating…' : ''}
        </span>
      </div>
      <div
        className={cn(
          'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4',
          fetching && 'opacity-70 transition-opacity',
        )}
      >
        <StatCard
          label="Spend"
          value={formatMetric(metrics, 'spend')}
          hint={noDelivery ? 'No delivery in this period' : currency}
        />
        <StatCard
          label="Leads"
          value={formatMetric(metrics, 'leads')}
          hint={metrics ? `CPL ${formatMetric(metrics, 'cpl')}` : undefined}
        />
        <StatCard
          label="Link clicks"
          value={formatMetric(metrics, 'linkClicks')}
          hint={
            metrics ? `CTR ${formatMetric(metrics, 'ctr')} · CPC ${formatMetric(metrics, 'cpc')}` : undefined
          }
        />
        <StatCard
          label="Impressions"
          value={formatMetric(metrics, 'impressions')}
          hint={metrics ? `CPM ${formatMetric(metrics, 'cpm')}` : undefined}
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="grid min-w-0 content-start gap-6 xl:col-span-2">
          <section className="grid min-w-0 content-start gap-2" aria-labelledby="adsets-title">
            <h2 id="adsets-title" className="text-base font-semibold tracking-tight">
              Ad sets <span className="text-muted-foreground tabular-nums">{campaign.adSets.length}</span>
            </h2>
            <DataTable
              aria-label="Ad sets"
              columns={adSetColumns}
              data={campaign.adSets}
              getRowId={(s) => s.id}
              selectable={canManage}
              bulkActions={({ selected, clear }) =>
                bulkButtons(
                  'ADSET',
                  selected.map((s) => ({ id: s.id, name: s.name })),
                  clear,
                )
              }
              rowClassName={(s) => (s.id === focusAdSet ? 'bg-primary/[0.06]' : undefined)}
              stickyHeader={false}
              minWidth={1080}
              emptyState={
                <EmptyState
                  compact
                  title="No ad sets"
                  description="This campaign has no ad sets (or they were deleted in Meta)."
                />
              }
            />
          </section>
          <section className="grid min-w-0 content-start gap-2" aria-labelledby="ads-title">
            <h2 id="ads-title" className="text-base font-semibold tracking-tight">
              Ads <span className="text-muted-foreground tabular-nums">{campaign.ads.length}</span>
            </h2>
            <DataTable
              aria-label="Ads"
              columns={adColumns}
              data={campaign.ads}
              getRowId={(a) => a.id}
              selectable={canManage}
              bulkActions={({ selected, clear }) =>
                bulkButtons(
                  'AD',
                  selected.map((a) => ({ id: a.id, name: a.name })),
                  clear,
                )
              }
              rowClassName={(a) => (a.id === focusAd ? 'bg-primary/[0.06]' : undefined)}
              stickyHeader={false}
              minWidth={960}
              emptyState={<EmptyState compact title="No ads" description="This campaign has no ads." />}
            />
          </section>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueList
                items={[
                  { label: 'Campaign ID', value: <MetaId value={campaign.metaCampaignId} /> },
                  {
                    label: 'Ad account',
                    value: (
                      <Link href={`/ad-accounts/${campaign.adAccount.id}`} className="hover:underline">
                        {campaign.adAccount.name}
                      </Link>
                    ),
                  },
                  { label: 'Currency · time zone', value: `${currency} · ${tz}` },
                  { label: 'Objective', value: objectiveLabel(campaign.objective) },
                  {
                    label: 'Budget',
                    value: campaign.budget
                      ? `${formatAmount(campaign.budget.amount, currency)} ${campaign.budget.type === 'DAILY' ? 'daily' : 'lifetime'}`
                      : 'Set on ad sets',
                  },
                  {
                    label: 'Bid strategy',
                    value: campaign.bidStrategy ? humanize(campaign.bidStrategy) : null,
                  },
                  {
                    label: 'Countries',
                    value: campaign.countries.length ? campaign.countries.map(countryName).join(', ') : null,
                  },
                  {
                    label: 'Special ad categories',
                    value: campaign.specialAdCategories.length ? (
                      <span className="flex flex-wrap gap-1">
                        {campaign.specialAdCategories.map((c) => (
                          <Badge key={c} variant="muted" size="sm">
                            {humanize(c)}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      'None'
                    ),
                  },
                  { label: 'Last synced', value: <RelativeTime value={campaign.lastSyncedAt} /> },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>
                Status and budget changes, launches and Meta events for this campaign.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {campaign.timeline.length ? (
                <ActivityTimeline events={campaign.timeline} />
              ) : (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
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
