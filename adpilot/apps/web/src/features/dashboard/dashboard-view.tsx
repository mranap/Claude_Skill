'use client';

import type { MetricsDto, StatusTone } from '@adpilot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Bell,
  Briefcase,
  CircleAlert,
  CircleCheck,
  Megaphone,
  Plug,
  ShieldCheck,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type * as React from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { formatDay } from '@/components/product/daily-chart';
import { toneToVariant } from '@/components/product/status';
import { statsRangeParams, StatsRangePicker, type StatsRange } from '@/components/product/stats-range-picker';
import { useAuth } from '@/features/auth/auth-context';
import { useUnreadCount } from '@/features/notifications/hooks';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { ISODateString } from '@/lib/api/types';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils/cn';
import { formatAmount } from '@/lib/utils/money';
import { ActivityTimeline } from '../activity/activity-timeline';
import type { ActivityEventDto } from '../activity/types';
import { formatCount } from '../statistics/metrics';
import { SeriesCard } from '../statistics/series-card';
import type { StatsSeriesPoint } from '../statistics/types';

interface Money {
  currency: string;
  value: string | null;
}

/** GET /dashboard */
interface DashboardDto {
  range: { key: string; label: string; perAccount: Record<string, { since: string; until: string }> };
  cards: {
    metaProfiles: { total: number; active: number };
    adAccounts: { connected: number; active: number };
    activeCampaigns: number;
    spend: Money[];
    leads: number;
    cpl: Money[];
    apiErrors24h: number;
    accountAlerts: number;
  };
  metrics: MetricsDto[];
  primaryCurrency: string;
  series: StatsSeriesPoint[];
  alerts: {
    kind: 'AD_ACCOUNT' | 'META_PROFILE';
    id: string;
    name: string;
    status: string;
    tone: StatusTone;
    message: string | null;
  }[];
  recentEvents: (ActivityEventDto & { createdAt: ISODateString })[];
}

function greeting(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Primary amount with the other currencies underneath (amounts in different currencies are never added). */
function MoneyValue({ items }: { items: Money[] }) {
  if (!items.length) return <>—</>;
  return <>{formatAmount(items[0]!.value, items[0]!.currency)}</>;
}

function otherCurrencies(items: Money[]): string | undefined {
  if (items.length < 2) return undefined;
  return items
    .slice(1)
    .map((m) => formatAmount(m.value, m.currency))
    .join(' · ');
}

function describeRange(data: DashboardDto | undefined): string | null {
  if (!data) return null;
  const ranges = Object.values(data.range.perAccount);
  if (!ranges.length) return null;
  const same = ranges.every((r) => r.since === ranges[0]!.since && r.until === ranges[0]!.until);
  if (!same) return 'Dates follow each ad account’s time zone';
  const r = ranges[0]!;
  return r.since === r.until
    ? formatDay(r.since, 'EEE, MMM d')
    : `${formatDay(r.since)} – ${formatDay(r.until)}`;
}

export function DashboardView() {
  const { user, can } = useAuth();
  const now = useNow(60_000);
  const firstName = (user.name ?? '').trim().split(/\s+/)[0] || user.email.split('@')[0];
  const canStats = can('app.statistics.view');
  const [range, setRange] = useState<StatsRange>({ range: 'today' });
  const params = statsRangeParams(range);
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard(params),
    queryFn: () => api.get<DashboardDto>('/dashboard', params),
    enabled: canStats,
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  });
  const data = dashboard.data;
  const setupNeeded =
    !canStats ||
    (data ? data.cards.metaProfiles.total === 0 || data.cards.adAccounts.connected === 0 : false);

  return (
    <>
      <PageHeader
        title={`${greeting(new Date(now).getHours())}, ${firstName}`}
        description={
          canStats
            ? 'Spend, results and alerts across your connected ad accounts.'
            : 'Here’s an overview of your advertising workspace.'
        }
        actions={
          canStats ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatsRangePicker value={range} onChange={setRange} align="end" />
            </div>
          ) : null
        }
      />
      {canStats ? (
        <>
          {dashboard.error && !data ? (
            <ErrorAlert error={dashboard.error} onRetry={() => void dashboard.refetch()} className="mb-4" />
          ) : null}
          {data ? (
            <p className="-mt-3 mb-4 text-xs text-muted-foreground">
              {data.range.label}
              {describeRange(data) ? ` · ${describeRange(data)}` : ''} · in each ad account’s time zone
            </p>
          ) : null}
          <div
            className={cn(
              'grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4',
              dashboard.isFetching && data && 'opacity-80 transition-opacity',
            )}
          >
            <StatCard
              label="Spend"
              icon={Wallet}
              loading={dashboard.isLoading}
              value={<MoneyValue items={data?.cards.spend ?? []} />}
              hint={
                otherCurrencies(data?.cards.spend ?? []) ??
                (data?.cards.spend.length ? data.cards.spend[0]!.currency : 'No delivery')
              }
            />
            <StatCard
              label="Leads"
              icon={Users}
              loading={dashboard.isLoading}
              value={formatCount(data?.cards.leads ?? 0)}
              hint={
                data?.cards.cpl.length
                  ? `CPL ${data.cards.cpl.map((c) => formatAmount(c.value, c.currency)).join(' · ')}`
                  : 'No leads yet'
              }
            />
            <StatCard
              label="Active campaigns"
              icon={Megaphone}
              loading={dashboard.isLoading}
              value={formatCount(data?.cards.activeCampaigns ?? 0)}
              hint={
                <Link href="/campaigns?status=ACTIVE" className="hover:text-foreground hover:underline">
                  View campaigns
                </Link>
              }
            />
            <StatCard
              label="Ad accounts"
              icon={Briefcase}
              loading={dashboard.isLoading}
              value={data ? `${data.cards.adAccounts.active} / ${data.cards.adAccounts.connected}` : '—'}
              hint={
                data?.cards.accountAlerts ? (
                  <span className="text-warning-fg">{data.cards.accountAlerts} need attention</span>
                ) : data ? (
                  'active / connected'
                ) : undefined
              }
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <SeriesCard
              className="xl:col-span-2"
              series={data?.series}
              currency={data?.primaryCurrency}
              loading={dashboard.isLoading}
              fetching={dashboard.isFetching && !dashboard.isLoading}
              description={
                data && data.metrics.length > 1
                  ? `Per day in ${data.primaryCurrency}, the currency with the highest spend.`
                  : `Per day${data ? ` in ${data.primaryCurrency}` : ''}.`
              }
            />
            <AlertsCard data={data} loading={dashboard.isLoading} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>
                  Launches, status and budget changes, rule actions and Meta events.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data?.recentEvents.length ? (
                  <ActivityTimeline events={data.recentEvents} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {dashboard.isLoading ? 'Loading…' : 'Nothing happened yet.'}
                  </p>
                )}
              </CardContent>
            </Card>
            <div className="grid content-start gap-4">
              {setupNeeded ? <GettingStarted data={data} /> : null}
              <Recommendations />
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <GettingStarted data={undefined} />
          </div>
          <Recommendations />
        </div>
      )}
    </>
  );
}

function AlertsCard({ data, loading }: { data: DashboardDto | undefined; loading: boolean }) {
  const alerts = data?.alerts ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Needs attention
          {alerts.length ? (
            <Badge variant="warning" size="sm">
              {alerts.length}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>Meta profiles and ad accounts that are not active.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {loading && !data ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {data && !alerts.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-success-fg" aria-hidden />
            All profiles and ad accounts are active.
          </p>
        ) : null}
        {alerts.map((a) => (
          <Link
            key={`${a.kind}-${a.id}`}
            href={a.kind === 'AD_ACCOUNT' ? `/ad-accounts/${a.id}` : `/meta-profiles/${a.id}`}
            className="grid gap-1 rounded-lg border p-3 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="flex min-w-0 items-center gap-2">
              {a.tone === 'danger' ? (
                <CircleAlert className="size-4 shrink-0 text-destructive-fg" aria-hidden />
              ) : (
                <TriangleAlert className="size-4 shrink-0 text-warning-fg" aria-hidden />
              )}
              <span className="truncate text-sm font-medium">{a.name}</span>
              <StatusBadge
                status={a.status}
                label={a.status}
                tone={toneToVariant(a.tone)}
                size="sm"
                className="ml-auto shrink-0"
              />
            </span>
            <span className="text-xs text-muted-foreground">
              {a.kind === 'AD_ACCOUNT' ? 'Ad account' : 'Meta profile'}
              {a.message ? ` · ${a.message}` : ''}
            </span>
          </Link>
        ))}
        {data?.cards.apiErrors24h ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {data.cards.apiErrors24h} Meta API {data.cards.apiErrors24h === 1 ? 'call' : 'calls'} failed in
            the last 24 hours.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Step({
  index,
  title,
  description,
  href,
  cta,
  done = false,
}: {
  index: number;
  title: string;
  description: string;
  href: string;
  cta: string;
  done?: boolean;
}) {
  return (
    <li className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
          done ? 'border-success bg-success text-success-foreground' : 'border-input text-muted-foreground',
        )}
      >
        {done ? <CircleCheck className="size-3.5" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {!done ? (
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href={href}>
            {cta}
            <ArrowRight />
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

function GettingStarted({ data }: { data: DashboardDto | undefined }) {
  const { can } = useAuth();
  const hasProfile = (data?.cards.metaProfiles.total ?? 0) > 0;
  const hasAccount = (data?.cards.adAccounts.connected ?? 0) > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>Four steps to your first campaign launched from AdPilot.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="divide-y">
          {can('app.meta_profiles.manage') ? (
            <Step
              index={1}
              title="Connect a Meta profile"
              description="Add an access token (and optionally a proxy) — tokens are encrypted at rest."
              href="/meta-profiles"
              cta="Connect"
              done={hasProfile}
            />
          ) : null}
          <Step
            index={2}
            title="Connect ad accounts"
            description="Pick the ad accounts you want to manage and see their status and balance."
            href="/ad-accounts"
            cta="Open"
            done={hasAccount}
          />
          {can('app.creatives.manage') ? (
            <Step
              index={3}
              title="Upload creatives"
              description="Images and videos are validated against Meta’s limits before upload."
              href="/creatives"
              cta="Upload"
            />
          ) : null}
          {can('app.campaigns.launch') ? (
            <Step
              index={4}
              title="Launch a campaign"
              description="Build campaigns, ad sets and ads with the step-by-step launch wizard."
              href="/launch"
              cta="Launch"
            />
          ) : null}
        </ol>
      </CardContent>
    </Card>
  );
}

function Recommendations() {
  const { user, can } = useAuth();
  const unread = useUnreadCount();
  const items: { icon: React.ReactNode; title: string; description: string; href: string; cta: string }[] =
    [];
  if (!user.twoFactorEnabled) {
    items.push({
      icon: <ShieldCheck className="size-4" />,
      title: 'Turn on two-factor authentication',
      description: 'Protect access to your ad accounts with an authenticator app.',
      href: '/settings/security',
      cta: 'Enable 2FA',
    });
  }
  items.push({
    icon: <Bell className="size-4" />,
    title: unread.data
      ? `${unread.data} unread notification${unread.data === 1 ? '' : 's'}`
      : 'Get alerts in Telegram',
    description: unread.data
      ? 'Rejected ads, stopped campaigns and token problems.'
      : 'Rejected ads, stopped campaigns and token problems — instantly.',
    href: unread.data ? '/notifications' : '/settings/notifications',
    cta: unread.data ? 'Open' : 'Set up',
  });
  if (can('app.meta_profiles.manage')) {
    items.push({
      icon: <Plug className="size-4" />,
      title: 'Keep tokens healthy',
      description: 'Meta profiles are validated regularly; expiring tokens show up under “Needs attention”.',
      href: '/meta-profiles',
      cta: 'Profiles',
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recommended</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="group flex items-start gap-3 rounded-lg border p-3 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary-fg">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-sm font-medium">{item.title}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                {item.description}
              </span>
            </span>
            <ArrowRight
              className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
