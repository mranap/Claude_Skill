'use client';

import type { LaunchItemKind, LaunchJobStatus, MetaErrorDetails } from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, ExternalLink, Film, FolderKanban, ImageIcon, Layers, Megaphone, Palette, RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Stepper, type StepState, type StepperStep } from '@/components/ui/stepper';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { ErrorAlert } from '@/components/shared/error-alert';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { MetaId } from '@/components/product/meta-id';
import { ApiError, getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useNow } from '@/lib/hooks/use-now';
import { formatDateTime, formatDurationMs } from '@/lib/utils/format';
import { isTerminal, launchesApi, useLaunchJob } from './api';
import { LaunchStatusBadge } from './job-status';
import type { LaunchItemError, LaunchJobDto, LaunchJobItemDto } from './types';
import { PlanSummaryCard } from './wizard/review-step';

const PHASES: { status: LaunchJobStatus; title: string; kinds?: LaunchItemKind[] }[] = [
  { status: 'QUEUED', title: 'Queued' },
  { status: 'VALIDATING', title: 'Validation' },
  { status: 'UPLOADING_CREATIVES', title: 'Media', kinds: ['MEDIA_IMAGE', 'MEDIA_VIDEO'] },
  { status: 'CREATING_CAMPAIGN', title: 'Campaign', kinds: ['CAMPAIGN'] },
  { status: 'CREATING_ADSETS', title: 'Ad sets', kinds: ['ADSET'] },
  { status: 'CREATING_ADS', title: 'Ads', kinds: ['CREATIVE', 'AD'] },
  { status: 'VERIFYING', title: 'Verification' },
  { status: 'ACTIVATING', title: 'Activation' },
  { status: 'COMPLETED', title: 'Done' },
];

const KIND: Record<LaunchItemKind, { label: string; icon: typeof Film }> = {
  MEDIA_IMAGE: { label: 'Image', icon: ImageIcon },
  MEDIA_VIDEO: { label: 'Video', icon: Film },
  CAMPAIGN: { label: 'Campaign', icon: FolderKanban },
  ADSET: { label: 'Ad set', icon: Layers },
  CREATIVE: { label: 'Creative', icon: Palette },
  AD: { label: 'Ad', icon: Megaphone },
};

function phaseSteps(job: LaunchJobDto): { steps: StepperStep[]; current: number } {
  const phases = PHASES.filter((p) => p.status !== 'ACTIVATING' || job.activateOnSuccess);
  if (job.status === 'COMPLETED') {
    return { steps: phases.map((p) => ({ id: p.status, title: p.title, state: 'complete' as StepState })), current: phases.length - 1 };
  }
  let current = phases.findIndex((p) => p.status === job.status);
  let failedAt = -1;
  if (current === -1) {
    // Terminal failure/cancel: the phase of the first failed (or unfinished) item.
    const failed = job.items.find((i) => i.status === 'FAILED') ?? job.items.find((i) => i.status !== 'CREATED' && i.status !== 'VERIFIED');
    failedAt = failed ? phases.findIndex((p) => p.kinds?.includes(failed.kind)) : phases.findIndex((p) => p.status === 'VERIFYING');
    if (failedAt === -1) failedAt = 1;
    current = failedAt;
  }
  const steps = phases.map((p, i) => {
    let state: StepState = i < current ? 'complete' : i === current ? 'current' : 'upcoming';
    if (i === failedAt) state = job.status === 'CANCELLED' ? 'upcoming' : 'error';
    return { id: p.status, title: p.title, state, description: i === failedAt ? (job.status === 'CANCELLED' ? 'Cancelled' : 'Failed') : undefined };
  });
  return { steps, current };
}

function itemError(error: LaunchItemError | null): ApiError | null {
  if (!error) return null;
  return new ApiError({ status: error.meta?.httpStatus ?? 0, code: error.meta ? 'META_API_ERROR' : 'UNKNOWN_ERROR', message: error.message, meta: error.meta as MetaErrorDetails | undefined });
}

export function LaunchJobPage({ id }: { id: string }) {
  const job = useLaunchJob(id);
  if (job.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }
  if (job.isError || !job.data) {
    return (
      <>
        <PageHeader title="Launch" breadcrumbs={[{ label: 'Launch history', href: '/launch?tab=history' }, { label: 'Not available' }]} />
        <ErrorAlert error={job.error} onRetry={() => void job.refetch()} />
      </>
    );
  }
  return <JobView job={job.data} fetching={job.isFetching} />;
}

function JobView({ job, fetching }: { job: LaunchJobDto; fetching: boolean }) {
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const terminal = isTerminal(job.status);
  const { steps, current } = phaseSteps(job);
  const now = useNow(1000, !terminal);
  const duration = job.startedAt ? (job.finishedAt ? new Date(job.finishedAt).getTime() : now) - new Date(job.startedAt).getTime() : null;

  const retry = useMutation({
    mutationFn: () => launchesApi.retry(job.id),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.launches.detail(job.id), updated);
      toast.success('Retrying the failed steps', { description: 'Objects that were already created are reused.' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.launches.all });
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const columns: DataTableColumn<LaunchJobItemDto>[] = [
    {
      id: 'object',
      header: 'Object',
      cell: (item) => {
        const k = KIND[item.kind];
        const Icon = k.icon;
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="grid min-w-0 gap-0.5">
              <span className="truncate font-medium">{item.name}</span>
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
          </div>
        );
      },
    },
    { id: 'status', header: 'Status', cell: (item) => <StatusBadge status={item.status} size="sm" /> },
    { id: 'meta', header: 'Meta id', interactive: true, cell: (item) => <MetaId value={item.metaId} /> },
    { id: 'attempts', header: 'Attempts', align: 'right', cell: (item) => <span className="tabular-nums">{item.attemptCount}</span> },
    {
      id: 'error',
      header: 'Details',
      className: 'max-w-md',
      cell: (item) =>
        item.lastError ? (
          <span className="line-clamp-2 text-xs text-destructive-fg">{item.lastError.meta?.friendlyMessage ?? item.lastError.message}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{item.status === 'IN_FLIGHT' ? 'Sending to Meta…' : '—'}</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Launch history', href: '/launch?tab=history' }, { label: job.name }]}
        title={job.name}
        meta={
          <>
            <LaunchStatusBadge status={job.status} />
            <Badge variant="outline" className="font-mono">
              {job.code}
            </Badge>
          </>
        }
        description={
          <>
            {job.adAccount.name} · <span className="font-mono">act_{job.adAccount.metaAccountId}</span> · started {formatDateTime(job.startedAt ?? job.queuedAt)}
            {job.finishedAt ? ` · finished ${formatDateTime(job.finishedAt)}` : ''}
          </>
        }
        actions={
          <>
            {!terminal ? (
              <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={!!job.cancelRequestedAt}>
                <Ban />
                {job.cancelRequestedAt ? 'Cancelling…' : 'Cancel'}
              </Button>
            ) : null}
            {job.status === 'FAILED' || job.status === 'PARTIAL_FAILURE' ? (
              <Button onClick={() => retry.mutate()} loading={retry.isPending}>
                <RotateCcw />
                Retry failed steps
              </Button>
            ) : null}
            {job.metaCampaignId ? (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/campaigns?q=${job.metaCampaignId}`}>
                    <FolderKanban />
                    View campaign
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${job.adAccount.metaAccountId}&selected_campaign_ids=${job.metaCampaignId}`} target="_blank" rel="noreferrer noopener">
                    <ExternalLink />
                    Ads Manager
                  </a>
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4">
        <Card>
          <CardContent className="grid gap-4 py-5">
            <Stepper steps={steps} current={current} />
            <div className="grid gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium" aria-live="polite">
                  {terminal ? (job.status === 'COMPLETED' ? 'All objects were created' : job.status === 'CANCELLED' ? 'The launch was cancelled' : 'The launch stopped with errors') : 'Creating objects at Meta…'}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {job.createdItems} of {job.totalItems} created{job.failedItems ? ` · ${job.failedItems} failed` : ''} · {job.progress}%
                  {duration !== null ? ` · ${formatDurationMs(duration)}` : ''}
                </span>
              </div>
              <Progress
                value={job.progress}
                tone={job.status === 'FAILED' ? 'danger' : job.status === 'PARTIAL_FAILURE' ? 'warning' : job.status === 'COMPLETED' ? 'success' : 'default'}
                indeterminate={!terminal && job.progress === 0}
                aria-label="Launch progress"
              />
              {!terminal ? <p className="text-xs text-muted-foreground">{fetching ? 'Refreshing…' : 'Updates every few seconds. You can leave this page — the launch continues in the background.'}</p> : null}
            </div>
          </CardContent>
        </Card>

        {job.error ? (
          <JobError error={job.error} />
        ) : null}
        {job.status === 'COMPLETED' ? (
          <Alert variant="success">
            <AlertTitle>Launch completed</AlertTitle>
            <AlertDescription>{job.activateOnSuccess ? 'Everything was created, verified and activated.' : 'Everything was created and verified. The campaign is paused — activate it when you are ready.'}</AlertDescription>
          </Alert>
        ) : null}
        {job.warnings?.length ? (
          <Alert variant="warning" icon={<TriangleAlert />}>
            <AlertTitle>Warnings from validation</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 grid gap-1">
                {job.warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Objects</CardTitle>
            <CardDescription>Everything this launch creates at Meta, in order. Expand a failed row for the Meta error details.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              aria-label="Launch objects"
              columns={columns}
              data={job.items}
              getRowId={(item) => item.id}
              minWidth={760}
              stickyHeader={false}
              renderExpanded={(item) =>
                item.lastError ? (
                  <ErrorAlert error={itemError(item.lastError)} title={`${KIND[item.kind].label} “${item.name}”`} />
                ) : (
                  <KeyValueList
                    className="max-w-xl"
                    items={[
                      { label: 'Key', value: item.key, mono: true },
                      { label: 'Meta id', value: item.metaId, mono: true, copy: item.metaId },
                      { label: 'Last update', value: <RelativeTime value={item.updatedAt} /> },
                    ]}
                  />
                )
              }
            />
          </CardContent>
        </Card>
        {job.summary ? <PlanSummaryCard summary={job.summary} /> : null}
      </div>
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        destructive
        title="Cancel this launch?"
        description="Objects that were already created at Meta stay (paused). The launch stops before creating the next object."
        confirmLabel="Cancel launch"
        cancelLabel="Keep running"
        onConfirm={async () => {
          await launchesApi.cancel(job.id);
          toast.success('Cancellation requested');
          await queryClient.invalidateQueries({ queryKey: queryKeys.launches.detail(job.id) });
        }}
      />
    </>
  );
}

function JobError({ error }: { error: NonNullable<LaunchJobDto['error']> }) {
  const details = error.details as LaunchItemError | undefined;
  if (details && typeof details === 'object' && 'message' in details) {
    return <ErrorAlert error={itemError(details)} title={error.message} />;
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>The launch failed</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}
