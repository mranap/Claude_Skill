'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Ellipsis, History, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { NavTabs } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  DataTable,
  DataTableToolbar,
  useUrlTableState,
  type DataTableColumn,
} from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/utils/format';
import { draftsApi, isTerminal, useDrafts, useLaunchJobs } from './api';
import { LaunchStatusBadge } from './job-status';
import type { DraftListItem, LaunchJobListItem } from './types';

export function LaunchHub() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'history' ? 'history' : 'drafts';
  return (
    <>
      <PageHeader
        title="Launch"
        description="Create campaigns, ad sets and ads in one guided flow. Drafts are saved automatically; launches run in the background."
        actions={
          <Button asChild>
            <Link href="/launch/new">
              <Plus />
              New launch
            </Link>
          </Button>
        }
      />
      <NavTabs
        className="mb-4"
        activeHref={tab === 'history' ? '/launch?tab=history' : '/launch'}
        items={[
          { href: '/launch', label: 'Drafts', icon: <Pencil /> },
          { href: '/launch?tab=history', label: 'Launch history', icon: <History /> },
        ]}
      />
      {tab === 'history' ? <LaunchHistory /> : <DraftsTable />}
    </>
  );
}

function DraftsTable() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const state = useUrlTableState({ filterKeys: [] });
  const drafts = useDrafts({ ...state.params, status: 'DRAFT' });
  const [discarding, setDiscarding] = useState<DraftListItem | null>(null);
  const clone = useMutation({
    mutationFn: (d: DraftListItem) => draftsApi.clone(d.id),
    onSuccess: async (copy) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.drafts.all });
      router.push(`/launch/${copy.id}`);
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const columns: DataTableColumn<DraftListItem>[] = [
    {
      id: 'name',
      header: 'Draft',
      interactive: true,
      cell: (d) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/launch/${d.id}`} className="truncate font-medium hover:underline">
            {d.name}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {d.template ? `From template “${d.template.name}”` : 'From scratch'}
          </span>
        </div>
      ),
    },
    {
      id: 'groups',
      header: 'Groups',
      align: 'right',
      cell: (d) => <span className="tabular-nums">{d.variants}</span>,
    },
    {
      id: 'validated',
      header: 'Last check',
      cell: (d) =>
        d.lastValidatedAt ? (
          <RelativeTime value={d.lastValidatedAt} />
        ) : (
          <span className="text-muted-foreground">Not checked</span>
        ),
    },
    { id: 'updated', header: 'Last edited', cell: (d) => <RelativeTime value={d.updatedAt} /> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      interactive: true,
      cell: (d) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => router.push(`/launch/${d.id}`)}>
              <Pencil />
              Continue
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => clone.mutate(d)}>
              <Copy />
              Clone
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDiscarding(d)}>
              <Trash2 />
              Discard
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <DataTable
        aria-label="Drafts"
        columns={columns}
        data={drafts.data?.items}
        total={drafts.data?.total}
        state={state}
        getRowId={(d) => d.id}
        isLoading={drafts.isLoading}
        isFetching={drafts.isFetching}
        error={drafts.error}
        onRetry={() => void drafts.refetch()}
        onRowClick={(d) => router.push(`/launch/${d.id}`)}
        minWidth={640}
        toolbar={<DataTableToolbar state={state} searchPlaceholder="Search drafts" />}
        emptyState={
          <EmptyState
            icon={Rocket}
            title={state.hasActiveFilters ? 'No drafts match' : 'No drafts'}
            description={
              state.hasActiveFilters
                ? undefined
                : 'Start a launch — every step is saved as a draft you can continue later.'
            }
            action={
              state.hasActiveFilters ? undefined : (
                <Button asChild>
                  <Link href="/launch/new">
                    <Plus />
                    New launch
                  </Link>
                </Button>
              )
            }
          />
        }
      />
      <ConfirmDialog
        open={!!discarding}
        onOpenChange={(open) => !open && setDiscarding(null)}
        destructive
        title={`Discard “${discarding?.name ?? ''}”?`}
        description="The draft is archived. Nothing was created at Meta."
        confirmLabel="Discard"
        onConfirm={async () => {
          if (!discarding) return;
          await draftsApi.archive(discarding.id);
          toast.success('Draft discarded');
          await queryClient.invalidateQueries({ queryKey: queryKeys.drafts.all });
        }}
      />
    </>
  );
}

export function LaunchHistory({ adAccountId }: { adAccountId?: string }) {
  const router = useRouter();
  const state = useUrlTableState({ filterKeys: ['tab'] });
  const params = { page: state.page, pageSize: state.pageSize, ...(state.q ? { q: state.q } : {}) };
  const jobs = useLaunchJobs(params);
  const items = adAccountId
    ? jobs.data?.items.filter((j) => j.adAccount.id === adAccountId)
    : jobs.data?.items;

  const columns: DataTableColumn<LaunchJobListItem>[] = [
    {
      id: 'name',
      header: 'Launch',
      interactive: true,
      cell: (j) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/launches/${j.id}`} className="truncate font-medium hover:underline">
            {j.name}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{j.code}</span>
        </div>
      ),
    },
    {
      id: 'account',
      header: 'Ad account',
      cell: (j) => <span className="truncate">{j.adAccount.name}</span>,
    },
    { id: 'status', header: 'Status', cell: (j) => <LaunchStatusBadge status={j.status} /> },
    {
      id: 'progress',
      header: 'Progress',
      cell: (j) => (
        <div className="grid w-40 gap-1">
          <Progress
            value={j.progress}
            tone={
              j.status === 'FAILED'
                ? 'danger'
                : j.status === 'PARTIAL_FAILURE'
                  ? 'warning'
                  : j.status === 'COMPLETED'
                    ? 'success'
                    : 'default'
            }
            indeterminate={!isTerminal(j.status) && j.progress === 0}
            aria-label={`Progress of ${j.name}`}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {j.createdItems}/{j.totalItems} created{j.failedItems ? ` · ${j.failedItems} failed` : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'created',
      header: 'Started',
      cell: (j) => (
        <span title={formatDateTime(j.createdAt)}>
          <RelativeTime value={j.createdAt} />
        </span>
      ),
    },
    {
      id: 'finished',
      header: 'Finished',
      cell: (j) =>
        j.finishedAt ? (
          <RelativeTime value={j.finishedAt} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <DataTable
      aria-label="Launch history"
      columns={columns}
      data={items}
      total={jobs.data?.total}
      state={state}
      getRowId={(j) => j.id}
      isLoading={jobs.isLoading}
      isFetching={jobs.isFetching}
      error={jobs.error}
      onRetry={() => void jobs.refetch()}
      onRowClick={(j) => router.push(`/launches/${j.id}`)}
      minWidth={820}
      toolbar={<DataTableToolbar state={state} searchPlaceholder="Search by name or code" />}
      emptyState={
        <EmptyState
          icon={History}
          title={state.q ? 'No launches match' : 'No launches yet'}
          description={state.q ? undefined : 'Launches appear here with their live progress.'}
        />
      }
    />
  );
}
