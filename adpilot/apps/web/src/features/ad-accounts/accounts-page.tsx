'use client';

import { AD_ACCOUNT_STATUS_DISPLAY, AD_ACCOUNT_STATUS_KEYS } from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Ellipsis, ExternalLink, Link2, Plug, RefreshCw, Unlink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SimpleTooltip } from '@/components/ui/tooltip';
import {
  DataTable,
  DataTableToolbar,
  FilterSelect,
  useUrlTableState,
  type DataTableColumn,
} from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { AdAccountStatusBadge } from '@/components/product/status';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage, getErrorTitle, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { formatAmount } from '@/lib/utils/money';
import { useMetaProfiles } from '../meta-profiles/api';
import { adAccountsApi, useAdAccounts } from './api';
import { ConnectAccountsPanel } from './connect-accounts';
import type { AdAccountDto } from './types';

const STATUS_OPTIONS = AD_ACCOUNT_STATUS_KEYS.filter((k) => !k.startsWith('ANY_')).map((k) => ({ value: k, label: AD_ACCOUNT_STATUS_DISPLAY[k].label }));

export function AccountsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can('app.meta_profiles.manage');
  const state = useUrlTableState({ filterKeys: ['profileId', 'status', 'connected'], defaultSort: 'name:asc' });
  const accounts = useAdAccounts(state.params);
  const profiles = useMetaProfiles(canManage);
  const [connectOpen, setConnectOpen] = useState(false);
  const actions = useAccountActions();

  const columns: DataTableColumn<AdAccountDto>[] = [
    {
      id: 'name',
      header: 'Ad account',
      sortField: 'name',
      cell: (a) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/ad-accounts/${a.id}`} className="truncate font-medium hover:underline">
            {a.name}
          </Link>
          <span className="truncate font-mono text-xs text-muted-foreground">act_{a.metaAccountId}</span>
        </div>
      ),
      interactive: true,
    },
    {
      id: 'status',
      header: 'Status',
      sortField: 'statusKey',
      cell: (a) => (
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <AdAccountStatusBadge statusKey={a.statusKey} label={a.statusLabel} tone={a.statusTone} />
            {!a.isConnected ? <Badge variant="muted">Not connected</Badge> : null}
          </div>
          {a.disableReasonLabel ? <span className="text-xs text-destructive-fg">{a.disableReasonLabel}</span> : null}
        </div>
      ),
    },
    {
      id: 'profile',
      header: 'Meta profile',
      cell: (a) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{a.profileName}</span>
          {a.profileStatus !== 'ACTIVE' ? <StatusBadge status={a.profileStatus} size="sm" /> : null}
        </span>
      ),
    },
    {
      id: 'currency',
      header: 'Currency / time zone',
      sortField: 'currency',
      cell: (a) => (
        <div className="grid gap-0.5">
          <span className="font-medium">{a.currency}</span>
          <span className="text-xs text-muted-foreground">{a.timezoneName}</span>
        </div>
      ),
    },
    {
      id: 'spent',
      header: 'Amount spent',
      sortField: 'amountSpent',
      align: 'right',
      cell: (a) => <span className="tabular-nums">{formatAmount(a.amountSpent, a.currency)}</span>,
    },
    {
      id: 'balance',
      header: 'Balance / spend cap',
      align: 'right',
      cell: (a) => (
        <div className="grid justify-items-end gap-0.5 tabular-nums">
          <span>{formatAmount(a.balance, a.currency)}</span>
          <span className="text-xs text-muted-foreground">{a.spendCap ? `cap ${formatAmount(a.spendCap, a.currency)}` : 'no cap'}</span>
        </div>
      ),
    },
    {
      id: 'checked',
      header: 'Last check',
      sortField: 'lastStatusCheckAt',
      cell: (a) =>
        a.isConnected ? (
          <div className="grid gap-0.5">
            {a.lastStatusCheckAt ? <RelativeTime value={a.lastStatusCheckAt} /> : <span className="text-muted-foreground">Pending</span>}
            {a.statusCheckError ? (
              <SimpleTooltip content={a.statusCheckError}>
                <span className="w-fit text-xs text-destructive-fg">Check failed</span>
              </SimpleTooltip>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      interactive: true,
      cell: (a) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => router.push(`/ad-accounts/${a.id}`)}>
              <Briefcase />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!a.isConnected} onSelect={() => actions.check.mutate(a)}>
              <RefreshCw />
              Check status now
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a.metaAccountId}`} target="_blank" rel="noreferrer noopener">
                <ExternalLink />
                Open in Ads Manager
              </a>
            </DropdownMenuItem>
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => actions.setConnected.mutate({ account: a, connected: !a.isConnected })}>
                  {a.isConnected ? <Unlink /> : <Link2 />}
                  {a.isConnected ? 'Disconnect' : 'Connect'}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Ad accounts"
        description="Accounts discovered through your Meta profiles. Connected accounts are monitored for status changes and their statistics are synchronised."
        actions={
          canManage ? (
            <Button onClick={() => setConnectOpen(true)}>
              <Link2 />
              Connect accounts
            </Button>
          ) : null
        }
      />
      <DataTable
        aria-label="Ad accounts"
        columns={columns}
        data={accounts.data?.items}
        total={accounts.data?.total}
        state={state}
        getRowId={(a) => a.id}
        isLoading={accounts.isLoading}
        isFetching={accounts.isFetching}
        error={accounts.error}
        onRetry={() => void accounts.refetch()}
        onRowClick={(a) => router.push(`/ad-accounts/${a.id}`)}
        minWidth={1080}
        toolbar={
          <DataTableToolbar
            state={state}
            searchPlaceholder="Search name, act_ id or business"
            filters={
              <>
                <FilterSelect state={state} filterKey="connected" allLabel="Connected" options={[{ value: 'false', label: 'Not connected' }, { value: 'all', label: 'All accounts' }]} aria-label="Connection" />
                <FilterSelect state={state} filterKey="status" allLabel="Any status" options={STATUS_OPTIONS} />
                {canManage && (profiles.data?.length ?? 0) > 1 ? (
                  <FilterSelect state={state} filterKey="profileId" allLabel="All profiles" options={(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
                ) : null}
              </>
            }
          />
        }
        emptyState={
          state.hasActiveFilters ? (
            <EmptyState compact icon={Briefcase} title="No ad accounts match the filters" action={<Button variant="outline" size="sm" onClick={state.reset}>Reset filters</Button>} />
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No connected ad accounts"
              description="Add a Meta profile, wait for the discovery to finish and connect the ad accounts you want to manage."
              action={
                canManage ? (
                  <>
                    <Button variant="outline" asChild>
                      <Link href="/meta-profiles">
                        <Plug />
                        Meta profiles
                      </Link>
                    </Button>
                    <Button onClick={() => setConnectOpen(true)}>
                      <Link2 />
                      Connect accounts
                    </Button>
                  </>
                ) : undefined
              }
            />
          )
        }
      />
      {canManage ? <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} /> : null}
    </>
  );
}

/** Check-now and connect/disconnect actions shared by the list and the detail page. */
export function useAccountActions(onCooldown?: (error: unknown) => boolean) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts.all });
  const check = useMutation({
    mutationFn: (account: AdAccountDto) => adAccountsApi.checkStatus(account.id),
    onSuccess: async (_r, account) => {
      toast.success('Status check queued', { description: `“${account.name}” is checked within a few seconds.` });
      await invalidate();
    },
    onError: (error) => {
      if (onCooldown?.(error)) return;
      if (isApiError(error, 'COOLDOWN')) toast.warning('Checked moments ago', { description: getErrorMessage(error) });
      else toast.error(getErrorTitle(error), { description: getErrorMessage(error) });
    },
  });
  const setConnected = useMutation({
    mutationFn: ({ account, connected }: { account: AdAccountDto; connected: boolean }) =>
      adAccountsApi.connect({ profileId: account.profileId, connect: connected ? [account.metaAccountId] : [], disconnect: connected ? [] : [account.metaAccountId] }),
    onSuccess: async (_r, { account, connected }) => {
      toast.success(connected ? `“${account.name}” connected` : `“${account.name}” disconnected`, {
        description: connected ? 'Pixels, audiences and campaigns are being synchronised.' : 'Monitoring, statistics and rules stop for this account.',
      });
      await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: queryKeys.metaProfiles.all })]);
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });
  return { check, setConnected };
}

function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const profiles = useMetaProfiles(open);
  const usable = (profiles.data ?? []).filter((p) => p.isEnabled);
  const [picked, setPicked] = useState<string | null>(null);
  const profileId = picked ?? usable[0]?.id ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Connect ad accounts</DialogTitle>
          <DialogDescription>Select the accounts to manage. Disconnecting stops monitoring, statistics sync and rules for that account.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {profiles.isLoading ? null : usable.length ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="connect-profile">Meta profile</Label>
                <Select value={profileId ?? ''} onValueChange={setPicked}>
                  <SelectTrigger id="connect-profile">
                    <SelectValue placeholder="Choose a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((p) => (
                      <SelectItem key={p.id} value={p.id} description={`${p.counts.connectedAdAccounts} of ${p.counts.adAccounts} accounts connected · ${p.statusLabel}`}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {profileId ? <ConnectAccountsPanel key={profileId} profileId={profileId} onSaved={() => onOpenChange(false)} /> : null}
            </>
          ) : (
            <EmptyState
              compact
              icon={Plug}
              title="No Meta profiles"
              description="Ad accounts are discovered through a Meta profile. Add one first."
              action={
                <Button asChild>
                  <Link href="/meta-profiles">Add a Meta profile</Link>
                </Button>
              }
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
