'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bot, FileClock } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  DataTable,
  DataTableToolbar,
  DateRangeFilter,
  FilterSelect,
  useUrlTableState,
  type DataTableColumn,
} from '@/components/shared/data-table';
import { parseRange, rangeToQuery } from '@/components/shared/date-range-picker';
import { EmptyState } from '@/components/shared/empty-state';
import { JsonViewer } from '@/components/shared/json-viewer';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { queryKeys } from '@/lib/api/query-keys';
import type { AuditLogDto } from '@/lib/api/types';
import { formatDateTime } from '@/lib/utils/format';
import { shortId } from '@/lib/utils/strings';
import { describeUserAgent } from '@/lib/utils/user-agent';
import { adminLogsApi } from './api';

const ACTION_PREFIXES = [
  { value: 'auth.login', label: 'Sign-ins' },
  { value: 'auth.password', label: 'Passwords' },
  { value: 'auth.2fa', label: 'Two-factor' },
  { value: 'auth.session', label: 'Sessions' },
  { value: 'auth.email', label: 'E-mail changes' },
  { value: 'auth.', label: 'All authentication' },
  { value: 'admin.user', label: 'User administration' },
  { value: 'admin.role', label: 'Roles' },
  { value: 'admin.settings', label: 'Settings' },
  { value: 'admin.broadcast', label: 'Broadcasts' },
  { value: 'admin.', label: 'All administration' },
  { value: 'telegram.', label: 'Telegram' },
];

function actionTone(action: string): 'danger' | 'warning' | 'success' | 'secondary' {
  if (/(failed|blocked|deleted|reuse|locked|revoked)/.test(action)) return action.includes('failed') || action.includes('reuse') ? 'danger' : 'warning';
  if (/(success|created|enabled|unblocked)/.test(action)) return 'success';
  return 'secondary';
}

function UserLink({ id, label }: { id: string | null; label: string | null }) {
  if (!id) return <span className="text-muted-foreground">{label ?? '—'}</span>;
  return (
    <Link href={`/admin/users/${id}`} className="hover:text-primary-fg hover:underline" onClick={(e) => e.stopPropagation()}>
      {label ?? shortId(id)}
    </Link>
  );
}

const columns: DataTableColumn<AuditLogDto>[] = [
  {
    id: 'time',
    header: 'Time',
    cell: (e) => (
      <div className="flex flex-col whitespace-nowrap">
        <span className="tabular-nums">{formatDateTime(e.createdAt, { seconds: true })}</span>
        <RelativeTime value={e.createdAt} className="text-xs text-muted-foreground" />
      </div>
    ),
  },
  {
    id: 'action',
    header: 'Action',
    cell: (e) => (
      <Badge variant={actionTone(e.action)} className="font-mono text-[11px]">
        {e.action}
      </Badge>
    ),
  },
  {
    id: 'actor',
    header: 'Actor',
    cell: (e) =>
      e.actorType === 'SYSTEM' && !e.actorUserId ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Bot className="size-3.5" />
          System
        </span>
      ) : (
        <UserLink id={e.actorUserId} label={e.actorLabel} />
      ),
  },
  { id: 'subject', header: 'Subject', cell: (e) => <UserLink id={e.subjectUserId} label={e.subjectLabel} /> },
  {
    id: 'target',
    header: 'Target',
    cell: (e) =>
      e.targetType ? (
        <span className="text-[13px]">
          <span className="text-muted-foreground">{e.targetType}</span>
          {e.targetId ? <span className="ml-1 font-mono text-xs">{shortId(e.targetId, 6, 4)}</span> : null}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { id: 'ip', header: 'IP', cell: (e) => <span className="font-mono text-xs">{e.ip ?? '—'}</span> },
];

export function AuditPage() {
  const table = useUrlTableState({ filterKeys: ['action', 'range'], defaultPageSize: 50 });
  const { range, ...rest } = table.params;
  const params = { ...rest, ...rangeToQuery(parseRange(typeof range === 'string' ? range : undefined, true)) };
  const audit = useQuery({
    queryKey: queryKeys.admin.audit(params),
    queryFn: ({ signal }) => adminLogsApi.audit(params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Audit log" description="Security-relevant actions by users, administrators and the system. Entries cannot be edited." />
      <DataTable
        aria-label="Audit log"
        columns={columns}
        data={audit.data?.items}
        total={audit.data?.total}
        state={table}
        getRowId={(e) => e.id}
        isLoading={audit.isPending}
        isFetching={audit.isFetching}
        error={audit.error}
        onRetry={() => void audit.refetch()}
        minWidth={900}
        renderExpanded={(e) => (
          <div className="grid gap-4 pt-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <KeyValueList
              className="rounded-md border bg-card p-3"
              items={[
                { label: 'Event ID', value: e.id, mono: true, copy: e.id },
                { label: 'Actor', value: e.actorEmail ?? e.actorLabel ?? e.actorType },
                { label: 'Actor ID', value: e.actorUserId, mono: true, copy: e.actorUserId },
                { label: 'Subject ID', value: e.subjectUserId, mono: true, copy: e.subjectUserId },
                { label: 'Target', value: e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : null, mono: true, copy: e.targetId },
                { label: 'Device', value: e.userAgent ? describeUserAgent(e.userAgent).label : null },
              ]}
            />
            <div className="grid content-start gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Metadata</p>
              {e.metadata ? <JsonViewer value={e.metadata} maxHeightClass="max-h-72" /> : <p className="text-sm text-muted-foreground">No metadata.</p>}
            </div>
          </div>
        )}
        toolbar={
          <DataTableToolbar
            state={table}
            searchPlaceholder="Search e-mail, action, target ID…"
            filters={
              <>
                <FilterSelect state={table} filterKey="action" allLabel="All actions" aria-label="Action" options={ACTION_PREFIXES} />
                <DateRangeFilter state={table} />
              </>
            }
          />
        }
        emptyState={
          table.hasActiveFilters ? undefined : (
            <EmptyState icon={FileClock} title="No audit events yet" description="Sign-ins, admin actions and setting changes will appear here." compact />
          )
        }
      />
    </>
  );
}
