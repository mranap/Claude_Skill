'use client';

import { AD_ACCOUNT_STATUS_DISPLAY } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  CircleAlert,
  ExternalLink,
  Link2,
  RefreshCw,
  ScrollText,
  Unlink,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTablePagination, useLocalTableState } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { Form, FormField, FormRootError, NumberField } from '@/components/shared/form';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { CooldownButton } from '@/components/product/cooldown-button';
import { MetaId } from '@/components/product/meta-id';
import { AdAccountStatusBadge } from '@/components/product/status';
import { useAuth } from '@/features/auth/auth-context';
import { queryKeys } from '@/lib/api/query-keys';
import { useCooldown } from '@/lib/hooks/use-cooldown';
import { formatDateTime, formatMinutes, formatNumber } from '@/lib/utils/format';
import { formatAmount } from '@/lib/utils/money';
import { humanize } from '@/lib/utils/strings';
import { ActivityTimeline } from '../activity/activity-timeline';
import { useAccountActions } from './accounts-page';
import { adAccountsApi, useAccountPages, useAdAccount, useAudiences, usePixels } from './api';
import type { AdAccountDetailDto } from './types';

/** Default values of the "allowed check intervals" admin setting (the server validates the real list). */
const CHECK_INTERVALS = [60, 180, 360, 720, 1440];

export function AccountDetailPage({ id }: { id: string }) {
  const account = useAdAccount(id);
  if (account.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    );
  }
  if (account.isError || !account.data) {
    return (
      <>
        <PageHeader
          title="Ad account"
          breadcrumbs={[{ label: 'Ad accounts', href: '/ad-accounts' }, { label: 'Not available' }]}
        />
        <ErrorAlert error={account.error} onRetry={() => void account.refetch()} />
      </>
    );
  }
  return <AccountDetail account={account.data} />;
}

function AccountDetail({ account }: { account: AdAccountDetailDto }) {
  const { can } = useAuth();
  const canManage = can('app.meta_profiles.manage');
  const cooldown = useCooldown();
  const actions = useAccountActions(cooldown.fromError);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const display = AD_ACCOUNT_STATUS_DISPLAY[account.statusKey];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Ad accounts', href: '/ad-accounts' }, { label: account.name }]}
        title={account.name}
        meta={
          <>
            <AdAccountStatusBadge
              statusKey={account.statusKey}
              label={account.statusLabel}
              tone={account.statusTone}
            />
            {!account.isConnected ? <Badge variant="muted">Not connected</Badge> : null}
          </>
        }
        description={
          <>
            <span className="font-mono">act_{account.metaAccountId}</span> · {account.currency} ·{' '}
            {account.timezoneName} · Meta profile{' '}
            {canManage ? (
              <Link
                href={`/meta-profiles/${account.profileId}`}
                className="font-medium text-foreground hover:underline"
              >
                {account.profileName}
              </Link>
            ) : (
              account.profileName
            )}
          </>
        }
        actions={
          <>
            {canManage ? (
              <CooldownButton
                variant="outline"
                cooldown={cooldown}
                onClick={() => actions.check.mutate(account, { onSuccess: () => cooldown.start(120) })}
                loading={actions.check.isPending}
                disabled={!account.isConnected}
                cooldownHint="Manual checks are limited to one every 2 minutes"
              >
                <RefreshCw />
                Check status now
              </CooldownButton>
            ) : null}
            <Button variant="outline" asChild>
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.metaAccountId}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink />
                Ads Manager
              </a>
            </Button>
            {canManage ? (
              account.isConnected ? (
                <Button variant="outline" onClick={() => setDisconnectOpen(true)}>
                  <Unlink />
                  Disconnect
                </Button>
              ) : (
                <Button
                  onClick={() => actions.setConnected.mutate({ account, connected: true })}
                  loading={actions.setConnected.isPending}
                >
                  <Link2 />
                  Connect
                </Button>
              )
            ) : null}
          </>
        }
      />

      <div className="grid gap-4">
        {account.statusKey !== 'ACTIVE' &&
        account.statusKey !== 'ANY_ACTIVE' &&
        account.statusKey !== 'UNKNOWN' ? (
          <Alert variant={account.statusTone === 'danger' ? 'destructive' : 'warning'} icon={<CircleAlert />}>
            <AlertTitle>
              {account.statusLabel}
              {account.disableReasonLabel ? ` — ${account.disableReasonLabel}` : ''}
            </AlertTitle>
            <AlertDescription>{display.description}</AlertDescription>
          </Alert>
        ) : null}
        {account.profileStatus !== 'ACTIVE' ? (
          <Alert variant="warning">
            <AlertTitle>The Meta profile of this account is not active</AlertTitle>
            <AlertDescription>
              Status checks, statistics and launches need a working token. Fix the token of “
              {account.profileName}”.
            </AlertDescription>
          </Alert>
        ) : null}
        {account.statusCheckError ? (
          <Alert variant="warning">
            <AlertTitle>The last status check failed</AlertTitle>
            <AlertDescription>{account.statusCheckError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>Amounts are in the account currency ({account.currency}).</CardDescription>
            </CardHeader>
            <CardContent>
              <KeyValueList
                items={[
                  {
                    label: 'Account id',
                    value: `act_${account.metaAccountId}`,
                    mono: true,
                    copy: `act_${account.metaAccountId}`,
                  },
                  {
                    label: 'Status',
                    value: `${account.statusLabel}${account.accountStatus !== null ? ` (code ${account.accountStatus})` : ''}`,
                  },
                  {
                    label: 'Disable reason',
                    value: account.disableReasonLabel,
                    hidden: !account.disableReasonLabel,
                  },
                  {
                    label: 'Business',
                    value: account.business
                      ? `${account.business.name ?? 'Business'} · ${account.business.id}`
                      : null,
                  },
                  { label: 'Currency', value: account.currency },
                  { label: 'Time zone', value: account.timezoneName },
                  { label: 'Amount spent', value: formatAmount(account.amountSpent, account.currency) },
                  { label: 'Balance', value: formatAmount(account.balance, account.currency) },
                  {
                    label: 'Spend cap',
                    value: account.spendCap ? formatAmount(account.spendCap, account.currency) : 'No cap',
                  },
                  {
                    label: 'Minimum daily budget',
                    value: formatAmount(account.minDailyBudget, account.currency),
                  },
                  { label: 'DSA beneficiary', value: account.defaultDsaBeneficiary },
                  { label: 'DSA payer', value: account.defaultDsaPayor },
                  { label: 'Campaigns', value: formatNumber(account.counts.campaigns) },
                ]}
              />
            </CardContent>
          </Card>
          <div className="grid content-start gap-4">
            <MonitoringCard account={account} canManage={canManage} />
            <StatusHistoryCard accountId={account.id} />
          </div>
        </div>

        <Card>
          <CardContent className="pt-5">
            <Tabs defaultValue="activity">
              <TabsList className="mb-4">
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="pixels">Pixels ({account.counts.pixels})</TabsTrigger>
                <TabsTrigger value="audiences">Audiences ({account.counts.audiences})</TabsTrigger>
                <TabsTrigger value="pages">Pages</TabsTrigger>
              </TabsList>
              <TabsContent value="activity">
                <AccountActivity accountId={account.id} />
              </TabsContent>
              <TabsContent value="pixels">
                <PixelsTable accountId={account.id} />
              </TabsContent>
              <TabsContent value="audiences">
                <AudiencesTable accountId={account.id} />
              </TabsContent>
              <TabsContent value="pages">
                <PagesTable accountId={account.id} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        destructive
        title={`Disconnect “${account.name}”?`}
        description="Status monitoring, statistics synchronisation and automated rules stop for this account. Campaigns keep running at Meta. You can connect it again at any time."
        confirmLabel="Disconnect"
        onConfirm={() => actions.setConnected.mutateAsync({ account, connected: false })}
      />
    </>
  );
}

const monitoringSchema = z.object({
  statusCheckIntervalMinutes: z.number().int().min(15).max(10080),
  statsSyncEnabled: z.boolean(),
  statsSyncIntervalMinutes: z.number().int().min(1).max(1440),
});
type MonitoringValues = z.infer<typeof monitoringSchema>;

function MonitoringCard({ account, canManage }: { account: AdAccountDetailDto; canManage: boolean }) {
  const queryClient = useQueryClient();
  const initial: MonitoringValues = {
    statusCheckIntervalMinutes: account.statusCheckIntervalMinutes,
    statsSyncEnabled: account.statsSyncEnabled,
    statsSyncIntervalMinutes: account.statsSyncIntervalMinutes,
  };
  const form = useForm<MonitoringValues>({
    resolver: zodResolver(monitoringSchema),
    values: initial,
    resetOptions: { keepDirtyValues: true },
  });
  const syncEnabled = useWatch({ control: form.control, name: 'statsSyncEnabled' });
  const intervals = [...new Set([...CHECK_INTERVALS, account.statusCheckIntervalMinutes])].sort(
    (a, b) => a - b,
  );

  const save = async (values: MonitoringValues) => {
    const body: Partial<MonitoringValues> = {};
    if (values.statusCheckIntervalMinutes !== account.statusCheckIntervalMinutes)
      body.statusCheckIntervalMinutes = values.statusCheckIntervalMinutes;
    if (values.statsSyncEnabled !== account.statsSyncEnabled) body.statsSyncEnabled = values.statsSyncEnabled;
    if (values.statsSyncIntervalMinutes !== account.statsSyncIntervalMinutes)
      body.statsSyncIntervalMinutes = values.statsSyncIntervalMinutes;
    if (!Object.keys(body).length) return;
    const updated = await adAccountsApi.update(account.id, body);
    queryClient.setQueryData(queryKeys.adAccounts.detail(account.id), updated);
    form.reset({
      statusCheckIntervalMinutes: updated.statusCheckIntervalMinutes,
      statsSyncEnabled: updated.statsSyncEnabled,
      statsSyncIntervalMinutes: updated.statsSyncIntervalMinutes,
    });
    toast.success('Monitoring settings saved');
    await queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts.all });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitoring</CardTitle>
        <CardDescription>
          How often the account status is checked and statistics are synchronised.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form} onSubmit={save} className="grid gap-4">
          <FormRootError />
          <fieldset disabled={!canManage || !account.isConnected} className="grid gap-4 disabled:opacity-70">
            <FormField
              control={form.control}
              name="statusCheckIntervalMinutes"
              label="Status check interval"
              description={
                account.nextStatusCheckAt ? (
                  <>
                    Last check{' '}
                    {account.lastStatusCheckAt ? <RelativeTime value={account.lastStatusCheckAt} /> : 'never'}{' '}
                    · next <RelativeTime value={account.nextStatusCheckAt} />
                  </>
                ) : undefined
              }
              render={({ field, controlProps }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                  disabled={!canManage || !account.isConnected}
                >
                  <SelectTrigger {...controlProps}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {intervals.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        Every {formatMinutes(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FormField
              control={form.control}
              name="statsSyncEnabled"
              orientation="horizontal"
              label="Synchronise statistics"
              description={
                account.lastStatsSyncAt ? (
                  <>
                    Last sync <RelativeTime value={account.lastStatsSyncAt} /> (
                    {humanize(account.statsSyncStatus)})
                  </>
                ) : (
                  'Not synchronised yet'
                )
              }
              render={({ field, controlProps }) => (
                <Switch {...controlProps} checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            {syncEnabled ? (
              <NumberField
                control={form.control}
                name="statsSyncIntervalMinutes"
                label="Statistics sync interval"
                unit="minutes"
                min={1}
                max={1440}
                description="The administrator sets a minimum interval (35 minutes by default) to protect the Meta rate limits."
              />
            ) : null}
          </fieldset>
          {account.statsSyncError ? (
            <p className="text-xs text-destructive-fg">Last sync error: {account.statsSyncError}</p>
          ) : null}
          {canManage && account.isConnected ? (
            <div className="flex justify-end gap-2">
              {form.formState.isDirty ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => form.reset(initial)}>
                  Discard
                </Button>
              ) : null}
              <Button
                type="submit"
                size="sm"
                disabled={!form.formState.isDirty}
                loading={form.formState.isSubmitting}
              >
                Save
              </Button>
            </div>
          ) : null}
        </Form>
      </CardContent>
    </Card>
  );
}

function StatusHistoryCard({ accountId }: { accountId: string }) {
  const history = useQuery({
    queryKey: queryKeys.adAccounts.history(accountId),
    queryFn: () => adAccountsApi.statusHistory(accountId),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status history</CardTitle>
        <CardDescription>Every real status change detected by the monitoring.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.isLoading ? (
          <Skeleton className="h-20" />
        ) : history.isError ? (
          <ErrorAlert error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data?.length ? (
          <ol className="grid max-h-72 gap-3 overflow-y-auto">
            {history.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                {h.fromKey ? (
                  <AdAccountStatusBadge statusKey={h.fromKey} size="sm" />
                ) : (
                  <Badge variant="muted" size="sm">
                    First check
                  </Badge>
                )}
                <ArrowRight className="size-3.5 text-muted-foreground" aria-label="changed to" />
                <AdAccountStatusBadge statusKey={h.toKey} size="sm" />
                <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(h.detectedAt)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No status changes recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AccountActivity({ accountId }: { accountId: string }) {
  const state = useLocalTableState({ defaultPageSize: 25 });
  const params = { page: state.page, pageSize: state.pageSize };
  const activity = useQuery({
    queryKey: queryKeys.adAccounts.activity(accountId, params),
    queryFn: () => adAccountsApi.activity(accountId, params),
    placeholderData: keepPreviousData,
  });
  if (activity.isLoading) return <Skeleton className="h-32" />;
  if (activity.isError) return <ErrorAlert error={activity.error} onRetry={() => void activity.refetch()} />;
  if (!activity.data?.items.length)
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No activity yet"
        description="Status changes, launches, budget changes and rule actions of this account appear here."
      />
    );
  return (
    <div className="grid gap-3">
      <ActivityTimeline events={activity.data.items} />
      {activity.data.total > state.pageSize ? (
        <div className="rounded-lg border">
          <DataTablePagination state={state} total={activity.data.total} />
        </div>
      ) : null}
    </div>
  );
}

function PixelsTable({ accountId }: { accountId: string }) {
  const pixels = usePixels(accountId);
  if (pixels.isLoading) return <Skeleton className="h-24" />;
  if (pixels.isError) return <ErrorAlert error={pixels.error} onRetry={() => void pixels.refetch()} />;
  if (!pixels.data?.length)
    return (
      <EmptyState
        compact
        icon={ScrollText}
        title="No pixels"
        description="Pixels / datasets shared with this ad account appear after the next sync."
      />
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[520px]">
        <TableHeader>
          <TableRow>
            <TableHead>Pixel / dataset</TableHead>
            <TableHead>Last event</TableHead>
            <TableHead>Synced</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pixels.data.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <div className="grid gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {p.name}
                    {p.isUnavailable ? (
                      <Badge variant="warning" size="sm">
                        Unavailable
                      </Badge>
                    ) : null}
                  </span>
                  <MetaId value={p.metaPixelId} />
                </div>
              </TableCell>
              <TableCell>
                {p.lastFiredTime ? (
                  <RelativeTime value={p.lastFiredTime} />
                ) : (
                  <span className="text-muted-foreground">No events yet</span>
                )}
              </TableCell>
              <TableCell>
                <RelativeTime value={p.lastSyncedAt} className="text-xs text-muted-foreground" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AudiencesTable({ accountId }: { accountId: string }) {
  const audiences = useAudiences(accountId);
  if (audiences.isLoading) return <Skeleton className="h-24" />;
  if (audiences.isError)
    return <ErrorAlert error={audiences.error} onRetry={() => void audiences.refetch()} />;
  if (!audiences.data?.length)
    return (
      <EmptyState
        compact
        icon={Users}
        title="No custom audiences"
        description="Custom and lookalike audiences of the account appear after the next sync."
      />
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            <TableHead>Audience</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Approximate size</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {audiences.data.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <div className="grid gap-0.5">
                  <span className="font-medium">{a.name}</span>
                  <MetaId value={a.metaAudienceId} />
                </div>
              </TableCell>
              <TableCell>{a.subtype ? humanize(a.subtype) : '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {a.approximateCountMin && a.approximateCountMax
                  ? `${formatNumber(a.approximateCountMin)} – ${formatNumber(a.approximateCountMax)}`
                  : a.approximateCountMax
                    ? formatNumber(a.approximateCountMax)
                    : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PagesTable({ accountId }: { accountId: string }) {
  const pages = useAccountPages(accountId);
  if (pages.isLoading) return <Skeleton className="h-24" />;
  if (pages.isError) return <ErrorAlert error={pages.error} onRetry={() => void pages.refetch()} />;
  if (!pages.data?.length)
    return (
      <EmptyState
        compact
        icon={ScrollText}
        title="No pages"
        description="Pages available to the Meta profile appear after the next sync."
      />
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[520px]">
        <TableHeader>
          <TableRow>
            <TableHead>Page</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Instagram</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.data.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <div className="grid gap-0.5">
                  <span className="font-medium">{p.name}</span>
                  <MetaId value={p.metaPageId} />
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{p.category ?? '—'}</TableCell>
              <TableCell>
                {p.instagramUsername ? (
                  `@${p.instagramUsername}`
                ) : (
                  <span className="text-muted-foreground">Not linked</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
