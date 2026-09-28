'use client';

import { META_PROFILE_STATUS_LABELS, type MetaProfileStatus } from '@adpilot/shared';
import { Activity, ArrowRight, Briefcase, CircleAlert, Files, Gauge, Megaphone, Plug, Rocket, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ADMIN_NAV, filterNav } from '@/components/layout/nav-config';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils/cn';
import { formatBytes, formatNumber } from '@/lib/utils/format';
import { useAdminDashboard, type QueueSummary } from '../admin-ops/api';
import { HealthChecksCard } from '../admin-ops/health-checks';

function sum(values: Partial<Record<string, number>>): number {
  return Object.values(values).reduce<number>((n, v) => n + (v ?? 0), 0);
}

export function AdminDashboard() {
  const { can } = useAuth();
  const dashboard = useAdminDashboard();
  const data = dashboard.data;
  const links = filterNav(ADMIN_NAV, can).filter((item) => item.href !== '/admin');
  const loading = dashboard.isLoading;
  const profileProblems = data
    ? Object.entries(data.metaProfiles)
        .filter(([status]) => status !== 'ACTIVE')
        .map(([status, n]) => `${n} ${(META_PROFILE_STATUS_LABELS[status as MetaProfileStatus] ?? status).toLowerCase()}`)
    : [];

  return (
    <>
      <PageHeader
        title="Admin dashboard"
        description="Platform usage, health of every dependency and background queues. Counts cover all users."
        actions={
          can('admin.workers.view') ? (
            <Button variant="outline" asChild>
              <Link href="/admin/workers">
                <Activity />
                Monitoring
              </Link>
            </Button>
          ) : null
        }
      />
      {dashboard.error && !data ? <ErrorAlert error={dashboard.error} onRetry={() => void dashboard.refetch()} className="mb-4" /> : null}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Users"
          icon={Users}
          loading={loading}
          value={formatNumber(data?.users.ACTIVE ?? 0)}
          hint={data ? `active · ${formatNumber(data.users.BLOCKED ?? 0)} blocked · ${formatNumber(data.users.DELETED ?? 0)} deleted` : undefined}
        />
        <StatCard
          label="Meta profiles"
          icon={Plug}
          loading={loading}
          value={data ? `${formatNumber(data.metaProfiles.ACTIVE ?? 0)} / ${formatNumber(sum(data.metaProfiles))}` : '—'}
          hint={profileProblems.length ? <span className="text-warning-fg">{profileProblems.join(' · ')}</span> : 'active / total'}
        />
        <StatCard
          label="Ad accounts"
          icon={Briefcase}
          loading={loading}
          value={data ? `${formatNumber(data.adAccounts.connected)} / ${formatNumber(data.adAccounts.total)}` : '—'}
          hint="connected / discovered"
        />
        <StatCard label="Campaigns" icon={Megaphone} loading={loading} value={formatNumber(data?.campaigns ?? 0)} hint="synced, not deleted" />
        <StatCard
          label="Creative files"
          icon={Files}
          loading={loading}
          value={formatNumber(data?.files.count ?? 0)}
          hint={data ? `${formatBytes(data.files.bytes)} stored` : undefined}
        />
        <StatCard
          label="Launches (24 h)"
          icon={Rocket}
          loading={loading}
          value={formatNumber(data?.launches24h.total ?? 0)}
          hint={data?.launches24h.failed ? <span className="text-destructive-fg">{data.launches24h.failed} failed or partial</span> : 'none failed'}
        />
        <StatCard
          label="Meta API errors (24 h)"
          icon={Gauge}
          loading={loading}
          value={formatNumber(data?.metaApi24h.errors ?? 0)}
          hint={
            can('admin.logs.view') ? (
              <Link href="/admin/logs?tab=meta&onlyErrors=true" className="hover:text-foreground hover:underline">
                {data?.metaApi24h.rateLimited ?? 0} rate limited · view log
              </Link>
            ) : (
              `${data?.metaApi24h.rateLimited ?? 0} rate limited`
            )
          }
        />
        <StatCard
          label="Errors logged (24 h)"
          icon={CircleAlert}
          loading={loading}
          value={formatNumber(data?.workerErrors24h ?? 0)}
          hint={
            can('admin.logs.view') ? (
              <Link href="/admin/logs?level=ERROR" className="hover:text-foreground hover:underline">
                View system logs
              </Link>
            ) : (
              'API, workers and scheduler'
            )
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <HealthChecksCard className="xl:col-span-3" />
        <QueuesCard queues={data?.queues} loading={loading} className="xl:col-span-2" />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Administration</CardTitle>
          <CardDescription>Everything you have access to.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {can('admin.users.create') ? (
            <Link
              href="/admin/users"
              className="group flex items-center gap-3 rounded-lg border border-dashed p-3.5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary-fg">
                <UserPlus className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium">Invite a user</span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : null}
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 rounded-lg border p-3.5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <item.icon className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium">{item.title}</span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function QueuesCard({ queues, loading, className }: { queues: QueueSummary[] | undefined; loading: boolean; className?: string }) {
  const { can } = useAuth();
  const failed = (queues ?? []).reduce((n, q) => n + q.counts.failed, 0);
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Queues</CardTitle>
        <CardDescription>{queues ? `${formatNumber(failed)} failed jobs kept for inspection.` : 'Background jobs per queue.'}</CardDescription>
        {can('admin.workers.view') ? (
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/workers">
                Details
                <ArrowRight />
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        {loading && !queues ? <p className="px-6 text-sm text-muted-foreground">Loading…</p> : null}
        {queues ? (
          <Table aria-label="Queue summary">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Queue</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="pr-6 text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queues.map((q) => (
                <TableRow key={q.name}>
                  <TableCell className="pl-6 font-mono text-xs">
                    {can('admin.workers.view') ? (
                      <Link href={`/admin/workers?queue=${encodeURIComponent(q.name)}`} className="hover:underline">
                        {q.name}
                      </Link>
                    ) : (
                      q.name
                    )}
                    {q.paused ? <span className="ml-2 font-sans text-warning-fg">paused</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(q.counts.waiting + q.counts.delayed + q.counts.prioritized)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(q.counts.active)}</TableCell>
                  <TableCell className={cn('pr-6 text-right tabular-nums', q.counts.failed > 0 && 'font-medium text-destructive-fg')}>{formatNumber(q.counts.failed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
