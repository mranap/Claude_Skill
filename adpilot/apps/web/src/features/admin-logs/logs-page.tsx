'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Globe, ScrollText, Server } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge, StatusBadge, type BadgeVariant } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DataTable,
  DataTableToolbar,
  DateRangeFilter,
  FilterSelect,
  TextFilter,
  ToggleFilter,
  useUrlTableState,
  type DataTableColumn,
} from '@/components/shared/data-table';
import { parseRange, rangeToQuery } from '@/components/shared/date-range-picker';
import { EmptyState } from '@/components/shared/empty-state';
import { JsonViewer } from '@/components/shared/json-viewer';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { queryKeys } from '@/lib/api/query-keys';
import type { MetaApiLogDto, SystemLogDto } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatDurationMs, formatTime } from '@/lib/utils/format';
import { shortId } from '@/lib/utils/strings';
import { adminLogsApi } from './api';

function withRange(params: Record<string, string | number>): Record<string, string | number | undefined> {
  const { range, ...rest } = params;
  return { ...rest, ...rangeToQuery(parseRange(typeof range === 'string' ? range : undefined, true)) };
}

function TimeCell({ value }: { value: string }) {
  return (
    <div className="flex flex-col whitespace-nowrap">
      <span className="font-mono text-xs tabular-nums">{formatTime(value)}</span>
      <span className="text-xs text-muted-foreground">{formatDateTime(value).split(',').slice(0, 2).join(',')}</span>
    </div>
  );
}

// ───────────────────────────── System logs ─────────────────────────────

const systemColumns: DataTableColumn<SystemLogDto>[] = [
  { id: 'time', header: 'Time', cell: (l) => <TimeCell value={l.createdAt} /> },
  { id: 'level', header: 'Level', cell: (l) => <StatusBadge status={l.level} size="sm" /> },
  { id: 'source', header: 'Source', cell: (l) => <span className="font-mono text-xs">{l.source}</span> },
  {
    id: 'message',
    header: 'Message',
    className: 'max-w-[34rem]',
    cell: (l) => <p className="line-clamp-2 text-[13px] break-words">{l.message}</p>,
  },
  {
    id: 'refs',
    header: 'Job / user',
    cell: (l) => (
      <div className="flex flex-col font-mono text-xs text-muted-foreground">
        {l.jobId ? <span>job {shortId(l.jobId, 6, 3)}</span> : null}
        {l.userId ? (
          <Link href={`/admin/users/${l.userId}`} className="hover:text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
            user {shortId(l.userId, 6, 3)}
          </Link>
        ) : null}
        {!l.jobId && !l.userId ? '—' : null}
      </div>
    ),
  },
];

function useLogSources() {
  return useQuery({ queryKey: ['admin', 'logs', 'sources'], queryFn: adminLogsApi.sources, staleTime: 5 * 60_000 });
}

function SystemLogsTab() {
  const sources = useLogSources();
  const table = useUrlTableState({ filterKeys: ['level', 'source', 'range'], defaultPageSize: 50 });
  const params = withRange(table.params);
  const logs = useQuery({
    queryKey: queryKeys.admin.logs(params),
    queryFn: ({ signal }) => adminLogsApi.system(params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <DataTable
      aria-label="System logs"
      columns={systemColumns}
      data={logs.data?.items}
      total={logs.data?.total}
      state={table}
      getRowId={(l) => l.id}
      isLoading={logs.isPending}
      isFetching={logs.isFetching}
      error={logs.error}
      onRetry={() => void logs.refetch()}
      minWidth={880}
      rowClassName={(l) => (l.level === 'ERROR' ? 'bg-destructive/[0.03]' : undefined)}
      renderExpanded={(l) => (
        <div className="grid gap-3 pt-1">
          <p className="rounded-md border bg-card p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{l.message}</p>
          {l.context ? <JsonViewer value={l.context} maxHeightClass="max-h-72" /> : null}
          <KeyValueList
            className="max-w-xl"
            items={[
              { label: 'Log ID', value: l.id, mono: true, copy: l.id },
              { label: 'Job ID', value: l.jobId, mono: true, copy: l.jobId },
              { label: 'User ID', value: l.userId, mono: true, copy: l.userId },
            ]}
          />
        </div>
      )}
      toolbar={
        <DataTableToolbar
          state={table}
          searchPlaceholder="Search messages…"
          filters={
            <>
              <FilterSelect
                state={table}
                filterKey="level"
                allLabel="All levels"
                aria-label="Level"
                options={[
                  { value: 'ERROR', label: 'Error' },
                  { value: 'WARN', label: 'Warning' },
                  { value: 'INFO', label: 'Info' },
                  { value: 'DEBUG', label: 'Debug' },
                ]}
              />
              {sources.data?.systemSources.length ? (
                <FilterSelect state={table} filterKey="source" allLabel="All sources" options={sources.data.systemSources.map((v) => ({ value: v, label: v }))} />
              ) : (
                <TextFilter state={table} filterKey="source" placeholder="Source (exact)" />
              )}
              <DateRangeFilter state={table} />
            </>
          }
        />
      }
      emptyState={
        table.hasActiveFilters ? undefined : (
          <EmptyState icon={Server} title="No system logs" description="Warnings and errors from the API, workers and scheduler appear here." compact />
        )
      }
    />
  );
}

// ───────────────────────────── Meta API logs ─────────────────────────────

function httpTone(status: number | null): BadgeVariant {
  if (status === null) return 'muted';
  if (status >= 500) return 'danger';
  if (status >= 400) return 'warning';
  return 'success';
}

const metaColumns: DataTableColumn<MetaApiLogDto>[] = [
  { id: 'time', header: 'Time', cell: (l) => <TimeCell value={l.createdAt} /> },
  {
    id: 'user',
    header: 'User',
    cell: (l) =>
      l.userId ? (
        <Link
          href={`/admin/users/${l.userId}`}
          className={cn('block max-w-[12rem] truncate text-xs hover:text-primary-fg hover:underline', !l.userEmail && 'font-mono')}
          onClick={(e) => e.stopPropagation()}
        >
          {l.userEmail ?? shortId(l.userId, 6, 3)}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { id: 'account', header: 'Account', cell: (l) => <span className="font-mono text-xs">{l.metaAccountId ?? '—'}</span> },
  {
    id: 'request',
    header: 'Request',
    className: 'max-w-[22rem]',
    cell: (l) => (
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" size="sm" className="font-mono">
          {l.method}
        </Badge>
        <span className="truncate font-mono text-xs" title={l.path}>
          {l.path}
        </span>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'HTTP',
    cell: (l) => (
      <Badge variant={httpTone(l.httpStatus)} size="sm" className="font-mono tabular-nums">
        {l.httpStatus ?? '—'}
      </Badge>
    ),
  },
  {
    id: 'error',
    header: 'Meta error',
    cell: (l) =>
      l.errorCode !== null ? (
        <span className="font-mono text-xs text-destructive-fg">
          {l.errorCode}
          {l.errorSubcode !== null ? `/${l.errorSubcode}` : ''}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: 'duration',
    header: 'Duration',
    align: 'right',
    cell: (l) => <span className={cn('tabular-nums', l.durationMs > 5000 && 'text-warning-fg')}>{formatDurationMs(l.durationMs)}</span>,
  },
  {
    id: 'retries',
    header: 'Retries',
    align: 'right',
    cell: (l) => (
      <span className={cn('tabular-nums', l.retryCount ? 'text-foreground' : 'text-muted-foreground')}>
        {l.retryCount}
        {l.rateLimited ? <Badge variant="warning" size="sm" className="ml-1.5">RL</Badge> : null}
      </span>
    ),
  },
  {
    id: 'trace',
    header: 'fbtrace_id',
    interactive: true,
    cell: (l) =>
      l.fbtraceId ? (
        <span className="inline-flex items-center gap-1 font-mono text-xs">
          {l.fbtraceId.length > 10 ? `${l.fbtraceId.slice(0, 10)}…` : l.fbtraceId}
          <CopyButton value={l.fbtraceId} />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

function MetaLogsTab() {
  const sources = useLogSources();
  const table = useUrlTableState({ filterKeys: ['onlyErrors', 'category', 'range'], defaultPageSize: 50 });
  const params = withRange(table.params);
  const logs = useQuery({
    queryKey: queryKeys.admin.metaLogs(params),
    queryFn: ({ signal }) => adminLogsApi.meta(params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <DataTable
      aria-label="Meta API logs"
      columns={metaColumns}
      data={logs.data?.items}
      total={logs.data?.total}
      state={table}
      getRowId={(l) => l.id}
      isLoading={logs.isPending}
      isFetching={logs.isFetching}
      error={logs.error}
      onRetry={() => void logs.refetch()}
      minWidth={1100}
      rowClassName={(l) => (l.errorCode !== null || (l.httpStatus ?? 0) >= 400 ? 'bg-destructive/[0.03]' : undefined)}
      renderExpanded={(l) => (
        <div className="grid gap-4 pt-1 lg:grid-cols-2">
          <KeyValueList
            className="rounded-md border bg-card p-3"
            items={[
              { label: 'Category', value: l.category, mono: true },
              { label: 'Path', value: l.path, mono: true, copy: l.path },
              { label: 'Error type', value: l.errorType, mono: true },
              { label: 'Error message', value: l.errorMessage },
              { label: 'fbtrace_id', value: l.fbtraceId, mono: true, copy: l.fbtraceId },
              { label: 'User', value: l.userEmail ?? l.userId, copy: l.userEmail ?? l.userId },
              { label: 'Profile ID', value: l.profileId, mono: true, copy: l.profileId },
              { label: 'Job ID', value: l.jobId, mono: true, copy: l.jobId },
            ]}
          />
          <div className="grid content-start gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Usage headers</p>
            {l.usage ? <JsonViewer value={l.usage} maxHeightClass="max-h-72" /> : <p className="text-sm text-muted-foreground">Not reported.</p>}
          </div>
        </div>
      )}
      toolbar={
        <DataTableToolbar
          state={table}
          searchPlaceholder="Account ID, fbtrace_id, path or error…"
          filters={
            <>
              <ToggleFilter state={table} filterKey="onlyErrors" label="Only errors" />
              {sources.data?.metaCategories.length ? (
                <FilterSelect state={table} filterKey="category" allLabel="All categories" options={sources.data.metaCategories.map((v) => ({ value: v, label: v }))} />
              ) : (
                <TextFilter state={table} filterKey="category" placeholder="Category" />
              )}
              <DateRangeFilter state={table} />
            </>
          }
        />
      }
      emptyState={
        table.hasActiveFilters ? undefined : (
          <EmptyState icon={Globe} title="No Meta API calls yet" description="Every request to the Graph API is logged here with its usage headers." compact />
        )
      }
    />
  );
}

export function LogsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'meta' ? 'meta' : 'system';

  return (
    <>
      <PageHeader title="Logs" description="Technical logs for troubleshooting. Sensitive values (tokens, secrets) are redacted before storage." />
      <Tabs
        value={tab}
        onValueChange={(value) => router.replace(value === 'meta' ? `${pathname}?tab=meta` : pathname, { scroll: false })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="system">
            <ScrollText />
            System logs
          </TabsTrigger>
          <TabsTrigger value="meta">
            <Globe />
            Meta API logs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="system" className="pt-0">
          {tab === 'system' ? <SystemLogsTab /> : null}
        </TabsContent>
        <TabsContent value="meta" className="pt-0">
          {tab === 'meta' ? <MetaLogsTab /> : null}
        </TabsContent>
      </Tabs>
    </>
  );
}
