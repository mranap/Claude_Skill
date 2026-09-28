'use client';

import { Bell, BellOff, Check, CheckCheck, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTablePagination, useUrlTableState } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import type { NotificationDto } from '@/lib/api/types';
import { formatNumber } from '@/lib/utils/format';
import { useMarkAllRead, useMarkRead, useNotificationList } from './hooks';
import { NotificationItem } from './notification-item';

const FILTER_KEYS = ['filter'] as const;

export function NotificationCenter() {
  const table = useUrlTableState({ filterKeys: FILTER_KEYS, defaultPageSize: 25 });
  const unreadOnly = table.filters.filter === 'unread';
  const list = useNotificationList({ page: table.page, pageSize: table.pageSize, unreadOnly });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const unread = list.data?.unread ?? 0;

  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts about your ad accounts, campaigns, automations and security."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/settings/notifications">
                <Settings2 />
                Preferences
              </Link>
            </Button>
            <Button onClick={() => markAll.mutate()} disabled={!unread} loading={markAll.isPending}>
              <CheckCheck />
              Mark all as read
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Filter notifications"
          value={unreadOnly ? 'unread' : 'all'}
          onValueChange={(v) => table.setFilter('filter', v === 'unread' ? 'unread' : undefined)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: unread ? `Unread · ${formatNumber(unread)}` : 'Unread' },
          ]}
        />
        {list.data ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatNumber(list.data.total)} {unreadOnly ? 'unread' : 'total'}
          </p>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="divide-y">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex gap-3 px-5 py-4">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-5 w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : list.error ? (
          <div className="p-4">
            <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : list.data.items.length === 0 ? (
          unreadOnly ? (
            <EmptyState
              icon={Check}
              title="You’re all caught up"
              description="There are no unread notifications."
              action={
                <Button variant="outline" size="sm" onClick={() => table.setFilter('filter', undefined)}>
                  Show all notifications
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={BellOff}
              title="No notifications yet"
              description="When something needs your attention — a rejected ad, an expired token, a stopped campaign — it shows up here."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/notifications">
                    <Bell />
                    Set up delivery channels
                  </Link>
                </Button>
              }
            />
          )
        ) : (
          <ul className={list.isFetching ? 'divide-y opacity-70 transition-opacity' : 'divide-y'}>
            {list.data.items.map((n) => (
              <li key={n.id}>
                <NotificationItem
                  notification={n}
                  onOpen={open}
                  actions={
                    !n.readAt ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => markRead.mutate(n.id)}
                        loading={markRead.isPending && markRead.variables === n.id}
                      >
                        <Check />
                        Mark as read
                      </Button>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.total > 0 ? <DataTablePagination state={table} total={list.data.total} /> : null}
      </Card>
    </>
  );
}
