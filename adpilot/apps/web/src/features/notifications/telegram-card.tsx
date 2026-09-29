'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Send, Unplug } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorAlert } from '@/components/shared/error-alert';
import { useAuth } from '@/features/auth/auth-context';
import { useNow } from '@/lib/hooks/use-now';
import { queryKeys } from '@/lib/api/query-keys';
import type { TelegramLinkDto } from '@/lib/api/types';
import { formatCountdown, formatDateTime } from '@/lib/utils/format';
import { notificationsApi } from './api';

const LINK_TTL_MS = 10 * 60_000;

function TelegramGlyph({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden>
      <Send className="size-4 -translate-x-px translate-y-px" />
    </span>
  );
}

/**
 * Telegram connection: shows the status, issues a one-time deep link (valid 10 minutes) and polls the
 * status every 3 seconds until the bot confirms the link.
 */
export function TelegramCard() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [pendingLink, setPendingLink] = useState<TelegramLinkDto | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const status = useQuery({
    queryKey: queryKeys.notifications.telegram,
    queryFn: notificationsApi.telegramStatus,
    refetchInterval: (query) =>
      pendingLink && !query.state.data?.connected && new Date(pendingLink.expiresAt).getTime() > Date.now()
        ? 3000
        : false,
  });

  const connected = !!status.data?.connected;
  // Once connected, the pending deep link is irrelevant.
  const link = connected ? null : pendingLink;
  const setLink = setPendingLink;
  const now = useNow(1000, !!link);
  const remaining = link ? new Date(link.expiresAt).getTime() - now : 0;
  const waiting = !!link && remaining > 0;

  const wasConnected = useRef(connected);
  useEffect(() => {
    if (!wasConnected.current && connected && pendingLink) {
      toast.success('Telegram connected', { description: 'You will now receive notifications in Telegram.' });
    }
    wasConnected.current = connected;
  }, [connected, pendingLink]);

  const createLink = useMutation({
    mutationFn: notificationsApi.telegramLink,
    onSuccess: (res) => setLink(res),
  });

  const unlink = useMutation({
    mutationFn: notificationsApi.telegramUnlink,
    onSuccess: () => {
      setPendingLink(null);
      toast.success('Telegram disconnected');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.telegram }),
  });

  const test = useMutation({
    mutationFn: notificationsApi.sendTest,
    onSuccess: () => {
      toast.success('Test notification sent', {
        description: 'It appears in the Notification Center and in your enabled channels.',
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
    onError: (err) =>
      toast.error('Could not send a test notification', { description: (err as Error).message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Telegram
          {status.data ? (
            connected ? (
              <Badge variant="success">Connected</Badge>
            ) : status.data.botConfigured ? (
              <Badge variant="muted">Not connected</Badge>
            ) : (
              <Badge variant="warning">Unavailable</Badge>
            )
          ) : null}
        </CardTitle>
        <CardDescription>Receive alerts from the AdPilot bot in a private Telegram chat.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => test.mutate()} loading={test.isPending}>
            <Send />
            <span className="hidden sm:inline">Send test notification</span>
            <span className="sm:hidden">Test</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {status.isPending ? (
          <Skeleton className="h-20" />
        ) : status.error ? (
          <ErrorAlert error={status.error} onRetry={() => void status.refetch()} />
        ) : !status.data.botConfigured ? (
          <Alert variant="warning">
            <AlertTitle>Telegram notifications are not available yet</AlertTitle>
            <AlertDescription>
              An administrator needs to configure the Telegram bot first. E-mail and in-app notifications keep
              working.
              {can(['admin.settings.view', 'admin.telegram.manage']) ? (
                <>
                  {' '}
                  <Link
                    href="/admin/settings/telegram"
                    className="font-medium text-primary-fg hover:underline"
                  >
                    Configure the bot
                  </Link>
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : connected ? (
          <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <TelegramGlyph className="flex size-10 items-center justify-center rounded-full bg-info/10 text-info-fg" />
              <div>
                <p className="text-sm font-medium">
                  {status.data.username
                    ? `@${status.data.username}`
                    : (status.data.firstName ?? 'Telegram account')}
                  {status.data.username && status.data.firstName ? (
                    <span className="font-normal text-muted-foreground"> · {status.data.firstName}</span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Linked {formatDateTime(status.data.linkedAt)}
                  {status.data.botUsername ? ` · via @${status.data.botUsername}` : ''}
                </p>
                {status.data.lastError ? (
                  <p className="mt-1 text-xs text-destructive-fg">
                    Last delivery error: {status.data.lastError}
                  </p>
                ) : null}
              </div>
            </div>
            <Button variant="destructive-outline" size="sm" onClick={() => setConfirmUnlink(true)}>
              <Unplug />
              Disconnect
            </Button>
          </div>
        ) : link ? (
          <div className="grid gap-4 rounded-lg border p-4">
            {waiting ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2.5 text-sm font-medium">
                    <Spinner />
                    Waiting for confirmation from Telegram…
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Link expires in {formatCountdown(remaining)}
                  </span>
                </div>
                <Progress value={(remaining / LINK_TTL_MS) * 100} className="h-1" />
                <ol className="grid gap-1.5 text-[13px] text-muted-foreground">
                  <li>
                    1. Click <span className="font-medium text-foreground">Open Telegram</span> (or open the
                    link on your phone).
                  </li>
                  <li>
                    2. In the chat with{' '}
                    <span className="font-medium text-foreground">@{link.botUsername}</span>, press{' '}
                    <span className="font-medium text-foreground">Start</span>.
                  </li>
                  <li>3. This page updates automatically once the bot confirms the link.</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink />
                      Open Telegram
                    </a>
                  </Button>
                  <Button variant="ghost" onClick={() => setLink(null)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-xs break-all text-muted-foreground">
                  Link for another device: <span className="font-mono">{link.url}</span>
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  The link expired before Telegram confirmed it.
                </p>
                <Button onClick={() => createLink.mutate()} loading={createLink.isPending}>
                  <RefreshCw />
                  Generate a new link
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              We’ll create a one-time link to{' '}
              <span className="font-medium text-foreground">@{status.data.botUsername}</span>. Only the chat
              that opens it is linked to your account.
            </p>
            <Button onClick={() => createLink.mutate()} loading={createLink.isPending} className="shrink-0">
              <Send />
              Connect Telegram
            </Button>
          </div>
        )}
        {createLink.error ? <ErrorAlert error={createLink.error} className="mt-4" /> : null}
      </CardContent>

      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title="Disconnect Telegram?"
        description="You’ll stop receiving notifications in Telegram. Types set to “Telegram” will only appear in the Notification Center."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => unlink.mutateAsync()}
      />
    </Card>
  );
}
