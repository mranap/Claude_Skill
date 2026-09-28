'use client';

import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPES,
  type NotificationChannelPref,
  type NotificationType,
} from '@adpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, Layers, Mail, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/shared/error-alert';
import { queryKeys } from '@/lib/api/query-keys';
import { notificationsApi } from './api';

const CHANNEL_OPTIONS: SegmentedOption<NotificationChannelPref>[] = [
  { value: 'EMAIL', label: 'Email', icon: <Mail /> },
  { value: 'TELEGRAM', label: 'Telegram', icon: <Send /> },
  { value: 'BOTH', label: 'Both', icon: <Layers /> },
  { value: 'OFF', label: 'Off', icon: <BellOff /> },
];

const GROUPS: { title: string; types: NotificationType[] }[] = [
  {
    title: 'Ad accounts & tokens',
    types: ['AD_ACCOUNT_STATUS_CHANGED', 'TOKEN_EXPIRED', 'TOKEN_REVOKED', 'TOKEN_EXPIRING_SOON', 'ACCOUNT_SYNC_FAILED'],
  },
  {
    title: 'Campaigns & ads',
    types: ['CAMPAIGN_LAUNCHED', 'CAMPAIGN_CREATION_FAILED', 'CAMPAIGN_STOPPED', 'AD_REJECTED', 'BUDGET_CHANGED'],
  },
  { title: 'Automation & statistics', types: ['AUTO_RULE_TRIGGERED', 'STATISTICS_SYNC_FAILED'] },
  { title: 'Account & platform', types: ['SECURITY_ALERT', 'SYSTEM_MESSAGE'] },
];

/** Every type from the shared catalogue is shown; new types land in "Other" until grouped. */
function groupedTypes(): { title: string; types: NotificationType[] }[] {
  const known = new Set(GROUPS.flatMap((g) => g.types));
  const other = NOTIFICATION_TYPES.filter((t) => !known.has(t));
  const groups = GROUPS.map((g) => ({ ...g, types: g.types.filter((t) => (NOTIFICATION_TYPES as readonly string[]).includes(t)) }));
  return other.length ? [...groups, { title: 'Other', types: other }] : groups;
}

type Prefs = Record<NotificationType, NotificationChannelPref>;

export function PreferencesCard({ telegramConnected }: { telegramConnected: boolean }) {
  const queryClient = useQueryClient();
  const prefsQuery = useQuery({ queryKey: queryKeys.notifications.preferences, queryFn: notificationsApi.preferences });
  const [draft, setDraft] = useState<Partial<Prefs>>({});

  const server = Object.fromEntries((prefsQuery.data ?? []).map((p) => [p.type, p.channel])) as Partial<Prefs>;
  const value = (type: NotificationType): NotificationChannelPref => draft[type] ?? server[type] ?? 'OFF';
  const dirtyTypes = (Object.keys(draft) as NotificationType[]).filter((t) => draft[t] !== server[t]);
  const dirty = dirtyTypes.length > 0;

  const save = useMutation({
    mutationFn: () => notificationsApi.savePreferences(NOTIFICATION_TYPES.map((type) => ({ type, channel: value(type) }))),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.notifications.preferences, data);
      setDraft({});
      toast.success('Notification preferences saved');
    },
  });

  const setAll = (channel: NotificationChannelPref) =>
    setDraft(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, channel])) as Prefs);

  const usesTelegram = NOTIFICATION_TYPES.some((t) => value(t) === 'TELEGRAM' || value(t) === 'BOTH');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery preferences</CardTitle>
        <CardDescription>
          Choose where each type of notification is delivered. Everything always appears in the Notification Center.
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!prefsQuery.data}>
                Set all to…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Apply to every type</DropdownMenuLabel>
              {CHANNEL_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.value} onSelect={() => setAll(option.value)}>
                  {option.icon}
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6">
        {!telegramConnected && usesTelegram && prefsQuery.data ? (
          <Alert variant="info">
            <AlertDescription className="text-foreground/80">
              Telegram isn’t connected yet — Telegram deliveries are skipped until you connect it above. E-mail and in-app
              notifications are not affected.
            </AlertDescription>
          </Alert>
        ) : null}
        {prefsQuery.isPending ? (
          <div className="grid gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : prefsQuery.error ? (
          <ErrorAlert error={prefsQuery.error} onRetry={() => void prefsQuery.refetch()} />
        ) : (
          groupedTypes().map((group) => (
            <section key={group.title} aria-labelledby={`group-${group.title}`}>
              <h4 id={`group-${group.title}`} className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.title}
              </h4>
              <ul className="divide-y">
                {group.types.map((type) => {
                  const meta = NOTIFICATION_TYPE_LABELS[type];
                  const changed = draft[type] !== undefined && draft[type] !== server[type];
                  return (
                    <li key={type} className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {meta.label}
                          {changed ? <span className="size-1.5 rounded-full bg-primary" aria-label="Changed" /> : null}
                        </p>
                        <p className="text-[13px] leading-relaxed text-muted-foreground">{meta.description}</p>
                      </div>
                      <SegmentedControl
                        aria-label={`${meta.label} delivery channel`}
                        value={value(type)}
                        onValueChange={(channel) => setDraft((d) => ({ ...d, [type]: channel }))}
                        options={CHANNEL_OPTIONS}
                        size="sm"
                        className="shrink-0"
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
        {save.error ? <ErrorAlert error={save.error} /> : null}
      </CardContent>
      <CardFooter className="sticky bottom-0 justify-end gap-3 rounded-b-lg bg-card/95 backdrop-blur sm:justify-between">
        <p className="hidden text-xs text-muted-foreground sm:block">
          {dirty ? `${dirtyTypes.length} unsaved change${dirtyTypes.length === 1 ? '' : 's'}` : 'All changes saved'}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft({})}>
            Discard
          </Button>
          <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
            Save preferences
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
