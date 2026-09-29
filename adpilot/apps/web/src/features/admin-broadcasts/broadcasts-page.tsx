'use client';

import { broadcastSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Inbox, Mail, Radio, Send, Users, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable, useUrlTableState, type DataTableColumn } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { Form, FormField, FormRootError } from '@/components/shared/form';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { BroadcastDto, Paginated } from '@/lib/api/types';
import { formatDateTime, formatNumber } from '@/lib/utils/format';
import { UserMultiSelect, type PickedUser } from './user-multi-select';

type BroadcastInput = z.input<typeof broadcastSchema>;
type BroadcastOutput = z.output<typeof broadcastSchema>;

const CHANNELS = [
  {
    value: 'EMAIL' as const,
    label: 'E-mail',
    description: 'Sent through the configured SMTP server.',
    icon: Mail,
  },
  {
    value: 'TELEGRAM' as const,
    label: 'Telegram',
    description: 'Only for users who linked Telegram.',
    icon: Send,
  },
];

const columns: DataTableColumn<BroadcastDto>[] = [
  {
    id: 'created',
    header: 'Sent',
    cell: (b) => (
      <div className="flex flex-col whitespace-nowrap">
        <span className="tabular-nums">{formatDateTime(b.createdAt)}</span>
        <RelativeTime value={b.createdAt} className="text-xs text-muted-foreground" />
      </div>
    ),
  },
  {
    id: 'subject',
    header: 'Message',
    className: 'max-w-[26rem]',
    cell: (b) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{b.subject}</p>
        <p className="truncate text-xs text-muted-foreground">{b.body}</p>
      </div>
    ),
  },
  {
    id: 'channels',
    header: 'Channels',
    cell: (b) => (
      <div className="flex flex-wrap gap-1">
        {b.inApp ? (
          <Badge variant="outline" size="sm">
            In-app
          </Badge>
        ) : null}
        {b.channels.map((c) => (
          <Badge key={c} variant="outline" size="sm">
            {c === 'EMAIL' ? 'E-mail' : 'Telegram'}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    id: 'audience',
    header: 'Audience',
    cell: (b) => (b.audience === 'ALL' ? 'All users' : `${formatNumber(b.userIds.length)} selected`),
  },
  {
    id: 'recipients',
    header: 'Recipients',
    align: 'right',
    cell: (b) => <span className="tabular-nums">{formatNumber(b.recipientCount)}</span>,
  },
  { id: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
];

export function BroadcastsPage() {
  const queryClient = useQueryClient();
  const table = useUrlTableState({ defaultPageSize: 10 });
  const list = useQuery({
    queryKey: queryKeys.admin.broadcasts.list(table.params),
    queryFn: () => api.get<Paginated<BroadcastDto>>('/admin/broadcasts', table.params),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((b) => b.status === 'QUEUED' || b.status === 'RUNNING') ? 5000 : false,
  });

  const [picked, setPicked] = useState<PickedUser[]>([]);
  const [confirm, setConfirm] = useState<BroadcastOutput | null>(null);
  const form = useForm<BroadcastInput, unknown, BroadcastOutput>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: { subject: '', body: '', channels: ['EMAIL'], inApp: true, audience: 'ALL', userIds: [] },
  });
  const audience = useWatch({ control: form.control, name: 'audience' });
  const body = useWatch({ control: form.control, name: 'body' }) ?? '';

  const onSubmit = (values: BroadcastOutput) => {
    if (values.audience === 'SELECTED' && !values.userIds.length) {
      form.setError('userIds', { message: 'Select at least one user' });
      return;
    }
    if (!values.inApp && !values.channels.length) {
      form.setError('channels', { message: 'Choose at least one way to deliver the message' });
      return;
    }
    setConfirm(values);
  };

  const send = async () => {
    if (!confirm) return;
    await api.post<BroadcastDto>('/admin/broadcasts', confirm);
    toast.success('Broadcast queued', {
      description: 'Delivery runs in the background; the status updates below.',
    });
    form.reset();
    setPicked([]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.broadcasts.all });
  };

  const channelText = (values: BroadcastOutput) =>
    [
      ...(values.inApp ? ['in-app'] : []),
      ...values.channels.map((c) => (c === 'EMAIL' ? 'e-mail' : 'Telegram')),
    ].join(', ');

  return (
    <>
      <PageHeader
        title="Broadcasts"
        description="Send an announcement to platform users — maintenance windows, policy changes, new features."
      />

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>New message</CardTitle>
          <CardDescription>
            Messages go only to platform users with active accounts. Blocked and deleted users are skipped.
          </CardDescription>
        </CardHeader>
        <Form form={form} onSubmit={onSubmit}>
          <CardContent className="grid gap-5">
            <FormRootError />
            <FormField
              control={form.control}
              name="subject"
              label="Subject"
              render={({ field, controlProps }) => (
                <Input
                  {...field}
                  {...controlProps}
                  maxLength={200}
                  placeholder="Scheduled maintenance on Sunday"
                />
              )}
            />
            <FormField
              control={form.control}
              name="body"
              label="Message"
              description={`${body.length}/4000 characters. Plain text; line breaks are kept.`}
              render={({ field, controlProps }) => (
                <Textarea {...field} {...controlProps} maxLength={4000} rows={5} />
              )}
            />
            <div className="grid gap-5 lg:grid-cols-2">
              <FormField
                control={form.control}
                name="channels"
                label="Channels"
                description="In-app messages appear in the recipients’ Notification Center."
                render={({ field }) => (
                  <div className="grid gap-2">
                    <Controller
                      control={form.control}
                      name="inApp"
                      render={({ field: inApp }) => (
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-field p-3 hover:bg-accent/40">
                          <Checkbox
                            className="mt-0.5"
                            checked={inApp.value !== false}
                            onCheckedChange={(v) => inApp.onChange(v === true)}
                          />
                          <Bell className="mt-0.5 size-4 text-muted-foreground" />
                          <span>
                            <span className="block text-sm font-medium">In-app notification</span>
                            <span className="block text-xs text-muted-foreground">
                              Shown in the bell menu and the Notification Center.
                            </span>
                          </span>
                        </label>
                      )}
                    />
                    {CHANNELS.map((channel) => {
                      const checked = (field.value ?? []).includes(channel.value);
                      return (
                        <label
                          key={channel.value}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border bg-field p-3 hover:bg-accent/40"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={checked}
                            onCheckedChange={(v) =>
                              field.onChange(
                                v === true
                                  ? [...(field.value ?? []), channel.value]
                                  : (field.value ?? []).filter((c: string) => c !== channel.value),
                              )
                            }
                          />
                          <channel.icon className="mt-0.5 size-4 text-muted-foreground" />
                          <span>
                            <span className="block text-sm font-medium">{channel.label}</span>
                            <span className="block text-xs text-muted-foreground">{channel.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              <div className="grid content-start gap-3">
                <FormField
                  control={form.control}
                  name="audience"
                  label="Audience"
                  render={({ field }) => (
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      <RadioCard
                        value="ALL"
                        icon={<Users />}
                        title="All users"
                        description="Every active account."
                      />
                      <RadioCard
                        value="SELECTED"
                        icon={<UsersRound />}
                        title="Selected users"
                        description="Pick recipients."
                      />
                    </RadioGroup>
                  )}
                />
                {audience === 'SELECTED' ? (
                  <FormField
                    control={form.control}
                    name="userIds"
                    label="Recipients"
                    render={({ field, controlProps }) => (
                      <UserMultiSelect
                        id={controlProps.id}
                        invalid={controlProps['aria-invalid']}
                        value={picked}
                        onChange={(users) => {
                          setPicked(users);
                          field.onChange(users.map((u) => u.id));
                        }}
                      />
                    )}
                  />
                ) : null}
              </div>
            </div>
            <Alert variant="info">
              <AlertDescription className="text-foreground/80">
                Broadcasts ignore users’ notification preferences for the channels you pick. Use them
                sparingly — at most 10 per hour.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit">
              <Radio />
              Review and send
            </Button>
          </CardFooter>
        </Form>
      </Card>

      <h2 className="mb-3 text-base font-semibold">History</h2>
      <DataTable
        aria-label="Broadcast history"
        columns={columns}
        data={list.data?.items}
        total={list.data?.total}
        state={table}
        getRowId={(b) => b.id}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        stickyHeader={false}
        minWidth={860}
        renderExpanded={(b) => (
          <div className="grid gap-2 pt-1">
            <p className="rounded-md border bg-card p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {b.body}
            </p>
            {b.error ? <p className="text-xs text-destructive-fg">Error: {b.error}</p> : null}
            {b.completedAt ? (
              <p className="text-xs text-muted-foreground">Completed {formatDateTime(b.completedAt)}</p>
            ) : null}
          </div>
        )}
        emptyState={
          <EmptyState
            icon={Inbox}
            title="No broadcasts yet"
            description="Messages you send appear here with their delivery status."
            compact
          />
        }
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Send this broadcast?"
        description={
          confirm ? (
            <div className="space-y-2">
              <p>
                <span className="font-medium text-foreground">“{confirm.subject}”</span> will be sent to{' '}
                <span className="font-medium text-foreground">
                  {confirm.audience === 'ALL'
                    ? 'all active users'
                    : `${confirm.userIds.length} selected user${confirm.userIds.length === 1 ? '' : 's'}`}
                </span>{' '}
                via {channelText(confirm)}.
              </p>
              <p>Messages can’t be recalled once delivered.</p>
            </div>
          ) : null
        }
        confirmLabel="Send broadcast"
        onConfirm={send}
      />
    </>
  );
}
