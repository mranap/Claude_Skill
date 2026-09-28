'use client';

import { Bell, BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/shared/error-alert';
import type { NotificationDto } from '@/lib/api/types';
import { useLatestNotifications, useMarkAllRead, useMarkRead, useUnreadCount } from './hooks';
import { NotificationItem } from './notification-item';

/** Header bell: unread badge (polled every 60 s) and a popover with the latest notifications. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const latest = useLatestNotifications(open);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const count = unread.data ?? 0;

  const handleOpen = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative text-muted-foreground hover:text-foreground"
          aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        >
          <Bell />
          {count > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-destructive-foreground tabular-nums ring-2 ring-background">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{count ? `${count} unread` : 'You’re all caught up'}</p>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => markAll.mutate()}
            disabled={!count}
            loading={markAll.isPending}
          >
            <CheckCheck />
            Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-[min(26rem,60vh)]" viewportClassName="max-h-[min(26rem,60vh)]">
          <div className="p-1.5">
            {latest.isPending ? (
              Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex gap-3 px-2.5 py-2.5">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))
            ) : latest.error ? (
              <div className="p-2">
                <ErrorAlert error={latest.error} onRetry={() => void latest.refetch()} />
              </div>
            ) : latest.data?.items.length ? (
              latest.data.items.map((n) => <NotificationItem key={n.id} notification={n} compact onOpen={handleOpen} />)
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BellOff className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">No notifications yet</p>
                <p className="text-xs text-muted-foreground">Account, campaign and security events will show up here.</p>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="border-t p-1.5">
          <Button asChild variant="ghost" size="sm" className="w-full" onClick={() => setOpen(false)}>
            <Link href="/notifications">View all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
