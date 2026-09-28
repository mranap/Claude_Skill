'use client';

import type { PermissionKey } from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Cpu, DatabaseBackup, Eraser, Gauge, HardDrive, ListTree, Pause, Play, RotateCcw, Server, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { NavTabs } from '@/components/ui/tabs';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable, useLocalTableState, type DataTableColumn } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { CodeBlock, JsonViewer } from '@/components/shared/json-viewer';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils/cn';
import { replaceQuery } from '@/lib/utils/url';
import { formatBytes, formatCountdown, formatDateTime, formatDurationMs, formatNumber } from '@/lib/utils/format';
import {
  adminOpsApi,
  JOB_STATES,
  opsKeys,
  useBackups,
  useQueueJobs,
  useQueues,
  useRateLimits,
  useStorageStats,
  useWorkers,
  type BackupDto,
  type JobState,
  type QueueJob,
  type QueueSummary,
} from './api';
import { HealthChecksCard } from './health-checks';

type Tab = 'queues' | 'workers' | 'rate-limits' | 'storage' | 'backups';

const TABS: { tab: Tab; label: string; icon: React.ReactNode; permission: PermissionKey }[] = [
  { tab: 'queues', label: 'Queues', icon: <ListTree />, permission: 'admin.workers.view' },
  { tab: 'workers', label: 'Workers', icon: <Cpu />, permission: 'admin.workers.view' },
  { tab: 'rate-limits', label: 'Meta rate limits', icon: <Gauge />, permission: 'admin.workers.view' },
  { tab: 'storage', label: 'Storage', icon: <HardDrive />, permission: 'admin.storage.manage' },
  { tab: 'backups', label: 'Backups', icon: <DatabaseBackup />, permission: 'admin.backups.manage' },
];

/** Operations area: queues and failed jobs, worker heartbeats, Meta usage, storage and backups. */
export function MonitoringPage() {
  const { can } = useAuth();
  const searchParams = useSearchParams();
  const allowed = TABS.filter((t) => can(t.permission));
  const requested = searchParams.get('tab') as Tab | null;
  const tab = allowed.find((t) => t.tab === requested)?.tab ?? allowed[0]?.tab ?? 'queues';

  return (
    <>
      <PageHeader title="Monitoring" description="Background queues and failed jobs, worker heartbeats, Meta API usage, storage and backups." />
      {can('admin.dashboard.view') ? <HealthChecksCard className="mb-4" /> : null}
      <NavTabs
        className="mb-4"
        activeHref={`/admin/workers?tab=${tab}`}
        items={allowed.map((t) => ({ href: `/admin/workers?tab=${t.tab}`, label: t.label, icon: t.icon }))}
      />
      {tab === 'queues' ? <QueuesTab /> : null}
      {tab === 'workers' ? <WorkersTab /> : null}
      {tab === 'rate-limits' ? <RateLimitsTab /> : null}
      {tab === 'storage' ? <StorageTab /> : null}
      {tab === 'backups' ? <BackupsTab /> : null}
    </>
  );
}

// ───────────── Queues ─────────────

function QueuesTab() {
  const { can } = useAuth();
  const canManage = can('admin.workers.manage');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queues = useQueues();
  const queryClient = useQueryClient();
  const selected = searchParams.get('queue') ?? queues.data?.find((q) => q.counts.failed > 0)?.name ?? queues.data?.[0]?.name ?? null;
  const [cleaning, setCleaning] = useState<QueueSummary | null>(null);

  const select = (name: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', 'queues');
    next.set('queue', name);
    replaceQuery(pathname, next);
  };

  const pauseResume = useMutation({
    mutationFn: (q: QueueSummary) => (q.paused ? adminOpsApi.resume(q.name) : adminOpsApi.pause(q.name)),
    onSuccess: (_res, q) => {
      toast.success(q.paused ? `Queue “${q.name}” resumed` : `Queue “${q.name}” paused`);
      void queryClient.invalidateQueries({ queryKey: opsKeys.all });
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  return (
    <div className="grid gap-4">
      <Card className="gap-0 overflow-hidden py-0">
        {queues.error && !queues.data ? <ErrorAlert error={queues.error} onRetry={() => void queues.refetch()} className="m-4" /> : null}
        <Table aria-label="Queues" containerClassName="overflow-x-auto" style={{ minWidth: 880 }}>
          <TableHeader>
            <TableRow>
              <TableHead className="bg-surface-subtle">Queue</TableHead>
              {(['waiting', 'active', 'delayed', 'prioritized', 'failed', 'completed'] as JobState[]).map((s) => (
                <TableHead key={s} className="bg-surface-subtle text-right capitalize">
                  {s}
                </TableHead>
              ))}
              <TableHead className="bg-surface-subtle text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queues.isLoading
              ? Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {queues.data?.map((q) => (
              <TableRow
                key={q.name}
                data-state={q.name === selected ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => select(q.name)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') select(q.name);
                }}
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{q.name}</span>
                    {q.paused ? (
                      <Badge variant="warning" size="sm">
                        Paused
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                {(['waiting', 'active', 'delayed', 'prioritized', 'failed', 'completed'] as JobState[]).map((s) => (
                  <TableCell key={s} className={cn('text-right tabular-nums', s === 'failed' && q.counts.failed > 0 && 'font-medium text-destructive-fg', q.counts[s] === 0 && 'text-muted-foreground')}>
                    {formatNumber(q.counts[s])}
                  </TableCell>
                ))}
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {canManage ? (
                    <span className="inline-flex gap-1">
                      <SimpleTooltip content={q.paused ? 'Resume processing' : 'Pause processing (jobs keep queueing)'}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={q.paused ? `Resume ${q.name}` : `Pause ${q.name}`}
                          onClick={() => pauseResume.mutate(q)}
                          disabled={pauseResume.isPending}
                        >
                          {q.paused ? <Play /> : <Pause />}
                        </Button>
                      </SimpleTooltip>
                      <SimpleTooltip content="Clean finished jobs">
                        <Button variant="ghost" size="icon-xs" aria-label={`Clean ${q.name}`} onClick={() => setCleaning(q)}>
                          <Eraser />
                        </Button>
                      </SimpleTooltip>
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {selected ? <JobsPanel key={selected} queue={selected} canManage={canManage} /> : null}
      {cleaning ? <CleanDialog queue={cleaning} onClose={() => setCleaning(null)} /> : null}
    </div>
  );
}

function JobsPanel({ queue, canManage }: { queue: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<JobState>('failed');
  const table = useLocalTableState({ defaultPageSize: 25 });
  const jobs = useQueueJobs(queue, { state, page: table.page, pageSize: table.pageSize });
  const [removing, setRemoving] = useState<QueueJob | null>(null);

  const retry = useMutation({
    mutationFn: (job: QueueJob) => adminOpsApi.retryJob(queue, job.id),
    onSuccess: () => {
      toast.success('Job queued for another attempt');
      void queryClient.invalidateQueries({ queryKey: opsKeys.all });
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const columns: DataTableColumn<QueueJob>[] = [
    {
      id: 'job',
      header: 'Job',
      cell: (j) => (
        <div className="grid min-w-0 max-w-[16rem] gap-0.5">
          <span className="truncate text-sm font-medium">{j.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground" title={j.id}>
            {j.id}
          </span>
        </div>
      ),
    },
    {
      id: 'attempts',
      header: 'Attempts',
      align: 'right',
      cell: (j) => (
        <span className="tabular-nums">
          {j.attemptsMade}
          {j.maxAttempts ? ` / ${j.maxAttempts}` : ''}
        </span>
      ),
    },
    {
      id: 'error',
      header: state === 'failed' ? 'Error' : 'Details',
      cell: (j) =>
        j.failedReason ? (
          <span className="line-clamp-2 max-w-[28rem] text-xs whitespace-normal text-destructive-fg">{j.failedReason}</span>
        ) : j.delay ? (
          <span className="text-xs text-muted-foreground">Delayed {formatDurationMs(j.delay)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'time',
      header: 'Time',
      cell: (j) => (
        <div className="grid gap-0.5 text-xs">
          <span>
            Created <RelativeTime value={new Date(j.timestamp)} />
          </span>
          {j.finishedOn ? (
            <span className="text-muted-foreground">
              Finished <RelativeTime value={new Date(j.finishedOn)} />
            </span>
          ) : j.processedOn ? (
            <span className="text-muted-foreground">
              Started <RelativeTime value={new Date(j.processedOn)} />
            </span>
          ) : null}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            interactive: true,
            cell: (j: QueueJob) => (
              <span className="inline-flex gap-1">
                {state === 'failed' ? (
                  <Button variant="ghost" size="xs" onClick={() => retry.mutate(j)} disabled={retry.isPending}>
                    <RotateCcw />
                    Retry
                  </Button>
                ) : null}
                {state !== 'active' ? (
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove job ${j.id}`} onClick={() => setRemoving(j)}>
                    <Trash2 />
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          Jobs in <span className="font-mono text-base">{queue}</span>
        </CardTitle>
        <CardDescription>Refreshed every 5 seconds. Job payloads are shown without message contents or secrets.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SegmentedControl
          aria-label="Job state"
          size="sm"
          value={state}
          onValueChange={(v) => {
            setState(v);
            table.setPage(1);
          }}
          options={JOB_STATES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          className="w-fit max-w-full overflow-x-auto"
        />
        <DataTable
          aria-label={`${state} jobs`}
          columns={columns}
          data={jobs.data?.items}
          total={jobs.data?.total}
          state={table}
          getRowId={(j) => j.id}
          isLoading={jobs.isLoading}
          isFetching={jobs.isFetching}
          error={jobs.error}
          onRetry={() => void jobs.refetch()}
          stickyHeader={false}
          minWidth={820}
          renderExpanded={(j) => (
            <div className="grid gap-3 pt-1 lg:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Payload</span>
                <JsonViewer value={j.data} maxHeightClass="max-h-64" />
              </div>
              <div className="grid content-start gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {j.stacktrace.length ? 'Last stack trace' : 'Timing'} · created {formatDateTime(new Date(j.timestamp), { seconds: true })}
                </span>
                {j.stacktrace.length ? <CodeBlock code={j.stacktrace.join('\n')} maxHeightClass="max-h-64" wrap /> : null}
                {j.failedReason ? <p className="text-sm text-destructive-fg">{j.failedReason}</p> : null}
              </div>
            </div>
          )}
          emptyState={<EmptyState compact icon={Server} title={`No ${state} jobs`} description={state === 'failed' ? 'Nothing failed in this queue.' : undefined} />}
        />
      </CardContent>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this job?"
        description={removing ? `${removing.name} (${removing.id}) is deleted from the queue and will not run again.` : undefined}
        confirmLabel="Remove job"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await adminOpsApi.removeJob(queue, removing.id);
          toast.success('Job removed');
          await queryClient.invalidateQueries({ queryKey: opsKeys.all });
        }}
      />
    </Card>
  );
}

function CleanDialog({ queue, onClose }: { queue: QueueSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'completed' | 'failed'>('completed');
  const [age, setAge] = useState('24');
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Clean “${queue.name}”?`}
      description="Deletes finished jobs from Redis. Failed jobs are kept for inspection until you clean them."
      confirmLabel="Clean"
      destructive={state === 'failed'}
      onConfirm={async () => {
        const res = await adminOpsApi.clean(queue.name, { state, olderThanHours: Number(age) });
        toast.success(`${res.removed} ${state} ${res.removed === 1 ? 'job' : 'jobs'} removed`);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="clean-state">Jobs</Label>
          <Select value={state} onValueChange={(v) => setState(v as 'completed' | 'failed')}>
            <SelectTrigger id="clean-state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="completed">Completed ({formatNumber(queue.counts.completed)})</SelectItem>
              <SelectItem value="failed">Failed ({formatNumber(queue.counts.failed)})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="clean-age">Older than</Label>
          <Select value={age} onValueChange={setAge}>
            <SelectTrigger id="clean-age">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any age</SelectItem>
              <SelectItem value="1">1 hour</SelectItem>
              <SelectItem value="24">1 day</SelectItem>
              <SelectItem value="168">7 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </ConfirmDialog>
  );
}

// ───────────── Workers ─────────────

function WorkersTab() {
  const workers = useWorkers();
  const data = workers.data;
  if (workers.error && !data) return <ErrorAlert error={workers.error} onRetry={() => void workers.refetch()} />;
  if (!data) return <Skeleton className="h-48 w-full rounded-lg" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Scheduler
            <StatusBadge status={data.scheduler ? 'ACTIVE' : 'DOWN'} label={data.scheduler ? 'Running' : 'No heartbeat'} tone={data.scheduler ? 'success' : 'danger'} size="sm" />
          </CardTitle>
          <CardDescription>The leader process that enqueues periodic work. Its heartbeat expires after a minute.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {data.scheduler ? (
            <>
              <p>
                <span className="font-mono">
                  {data.scheduler.host}:{data.scheduler.pid}
                </span>{' '}
                · heartbeat <RelativeTime value={data.scheduler.at} />
              </p>
              <div className="flex flex-wrap gap-1">
                {data.scheduler.tasks.map((t) => (
                  <Badge key={t} variant="outline" size="sm" className="font-mono">
                    {t}
                  </Badge>
                ))}
              </div>
            </>
          ) : (
            <p className="text-destructive-fg">No scheduler has reported in the last minute: periodic checks, syncs and rules are not being scheduled.</p>
          )}
        </CardContent>
      </Card>
      {data.workers.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState compact icon={Cpu} title="No worker processes" description="No worker has sent a heartbeat in the last 45 seconds. Background jobs are not being processed." />
          </CardContent>
        </Card>
      ) : null}
      {data.workers.map((w) => (
        <Card key={w.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="font-mono text-base">
                {w.host}:{w.pid}
              </span>
              <StatusBadge status="ACTIVE" label="Alive" tone="success" size="sm" />
            </CardTitle>
            <CardDescription>
              Heartbeat <RelativeTime value={w.at} />
              {w.startedAt ? (
                <>
                  {' '}
                  · started <RelativeTime value={w.startedAt} />
                </>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Memory</dt>
                <dd className="font-medium tabular-nums">{w.memoryMb !== undefined ? `${w.memoryMb} MB` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Processed</dt>
                <dd className="font-medium tabular-nums">{formatNumber(w.processed ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Failed attempts</dt>
                <dd className={cn('font-medium tabular-nums', (w.failed ?? 0) > 0 && 'text-destructive-fg')}>{formatNumber(w.failed ?? 0)}</dd>
              </div>
            </dl>
            <ul className="grid gap-1 sm:grid-cols-2">
              {w.queues.map((q) => (
                <li key={q.name} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', q.running ? 'bg-success' : 'bg-destructive')} />
                    <span className="truncate font-mono">{q.name}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">×{q.concurrency}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ───────────── Meta rate limits ─────────────

/** "acct:123" → "Ad account act_123"; the API reports scopes by their Redis key. */
function describeScope(key: string): string {
  const [kind, ...rest] = key.split(':');
  if (kind === 'acct') return `Ad account act_${rest.join(':')}`;
  if (kind === 'app') return `App ${rest.join(':')}`;
  if (kind === 'tok') return `Token of Meta profile ${rest.join(':').slice(0, 8)}`;
  if (kind === 'buc') return `Business ${rest[0] ?? ''}${rest[1] ? ` · ${rest.slice(1).join(':').replace(/_/g, ' ').toLowerCase()}` : ''}`;
  return key;
}

function RateLimitsTab() {
  const limits = useRateLimits();
  const now = useNow(1000);
  if (limits.error && !limits.data) return <ErrorAlert error={limits.error} onRetry={() => void limits.refetch()} />;
  if (!limits.data) return <Skeleton className="h-48 w-full rounded-lg" />;
  const rows = [...limits.data].sort((a, b) => b.state.pct - a.state.pct);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meta API usage</CardTitle>
        <CardDescription>
          The highest usage reported in Meta&apos;s headers per scope during the last hour. Requests slow down near the throttle threshold and pause when a
          scope is blocked (thresholds are in System settings → Meta API).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState compact icon={Gauge} title="No usage recorded" description="No Meta API calls reported usage headers in the last hour." />
        ) : (
          <ul className="grid gap-3" aria-label="Rate limit scopes">
            {rows.map((r) => {
              const blocked = r.state.blockedUntil > now;
              const tone = blocked || r.state.pct >= 90 ? 'danger' : r.state.pct >= 75 ? 'warning' : 'default';
              return (
                <li key={r.key} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{describeScope(r.key)}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{r.key}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {blocked ? (
                        <Badge variant="danger" size="sm">
                          Blocked · {formatCountdown(r.state.blockedUntil - now)}
                        </Badge>
                      ) : null}
                      <span className="font-medium tabular-nums">{r.state.pct}%</span>
                    </span>
                  </div>
                  <Progress value={r.state.pct} tone={tone} aria-label={`${r.key} usage`} />
                  <span className="text-xs text-muted-foreground">
                    Updated <RelativeTime value={new Date(r.state.at)} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────── Storage ─────────────

function StorageTab() {
  const storage = useStorageStats();
  const data = storage.data;
  if (storage.error && !data) return <ErrorAlert error={storage.error} onRetry={() => void storage.refetch()} />;
  if (!data) return <Skeleton className="h-48 w-full rounded-lg" />;
  const total = data.byType.reduce((n, t) => n + Number(t.bytes), 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Bucket <span className="font-mono text-base">{data.bucket}</span>
            <StatusBadge status={data.check.ok ? 'OK' : 'ERROR'} label={data.check.ok ? 'Reachable' : 'Unreachable'} tone={data.check.ok ? 'success' : 'danger'} size="sm" />
          </CardTitle>
          <CardDescription>{data.check.detail}</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/settings/files">Limits</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="font-medium tabular-nums">{formatBytes(total)}</dd>
            </div>
            {data.byType.map((t) => (
              <div key={t.type}>
                <dt className="text-xs text-muted-foreground">{t.type === 'IMAGE' ? 'Images' : t.type === 'VIDEO' ? 'Videos' : t.type}</dt>
                <dd className="font-medium tabular-nums">
                  {formatBytes(t.bytes)} <span className="font-normal text-muted-foreground">· {formatNumber(t.count)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Largest users</CardTitle>
          <CardDescription>Storage used by creatives, against each user&apos;s quota.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.topUsers.length === 0 ? <p className="text-sm text-muted-foreground">No files stored yet.</p> : null}
          {data.topUsers.map((u) => {
            const used = Number(u.storageUsedBytes);
            const quota = u.storageQuotaBytes ? Number(u.storageQuotaBytes) : null;
            const pct = quota ? Math.min(100, (used / quota) * 100) : null;
            return (
              <div key={u.id} className="grid gap-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/admin/users/${u.id}`} className="min-w-0 truncate hover:underline">
                    {u.email}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatBytes(used)}
                    {quota ? ` of ${formatBytes(quota)}` : ' · default quota'}
                  </span>
                </div>
                {pct !== null ? <Progress value={pct} tone={pct > 90 ? 'danger' : pct > 75 ? 'warning' : 'default'} aria-label={`Storage of ${u.email}`} /> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────── Backups ─────────────

function BackupsTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const backups = useBackups();
  const running = backups.data?.some((b) => b.status === 'QUEUED' || b.status === 'RUNNING');
  const backupNow = useMutation({
    mutationFn: adminOpsApi.backupNow,
    onSuccess: () => {
      toast.success('Backup started', { description: 'The database dump runs in the background; its status updates below.' });
      void queryClient.invalidateQueries({ queryKey: opsKeys.backups });
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });
  const retention = useMutation({
    mutationFn: adminOpsApi.retentionNow,
    onSuccess: () => toast.success('Retention cleanup queued', { description: 'Old logs, notifications and statistics are removed according to the retention settings.' }),
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const columns: DataTableColumn<BackupDto>[] = [
    { id: 'started', header: 'Started', cell: (b) => <RelativeTime value={b.startedAt} /> },
    { id: 'kind', header: 'Kind', cell: (b) => <span className="capitalize">{b.kind.toLowerCase()}</span> },
    { id: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
    { id: 'size', header: 'Size', align: 'right', cell: (b) => <span className="tabular-nums">{formatBytes(b.sizeBytes)}</span> },
    {
      id: 'duration',
      header: 'Duration',
      align: 'right',
      cell: (b) => <span className="tabular-nums">{b.finishedAt ? formatDurationMs(new Date(b.finishedAt).getTime() - new Date(b.startedAt).getTime()) : '—'}</span>,
    },
    {
      id: 'details',
      header: 'Location / error',
      cell: (b) =>
        b.error ? (
          <span className="line-clamp-2 max-w-[24rem] text-xs whitespace-normal text-destructive-fg">{b.error}</span>
        ) : b.storageKey ? (
          <span className="block max-w-[24rem] truncate font-mono text-xs text-muted-foreground" title={b.storageKey}>
            {b.storageKey}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database backups</CardTitle>
        <CardDescription>Scheduled and manual PostgreSQL dumps stored in object storage (the last 50 are listed).</CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          {can('admin.maintenance.manage') ? (
            <Button variant="outline" size="sm" onClick={() => retention.mutate()} loading={retention.isPending}>
              <Archive />
              Run retention cleanup
            </Button>
          ) : null}
          <Button size="sm" onClick={() => backupNow.mutate()} loading={backupNow.isPending} disabled={running}>
            <DatabaseBackup />
            {running ? 'Backup running…' : 'Back up now'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          aria-label="Backups"
          columns={columns}
          data={backups.data}
          getRowId={(b) => b.id}
          isLoading={backups.isLoading}
          isFetching={backups.isFetching}
          error={backups.error}
          onRetry={() => void backups.refetch()}
          stickyHeader={false}
          minWidth={760}
          emptyState={<EmptyState compact icon={DatabaseBackup} title="No backups yet" description="Scheduled backups run according to System settings → Backups." />}
        />
      </CardContent>
    </Card>
  );
}
