'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { AdAccountStatusBadge } from '@/components/product/status';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils/cn';
import { pluralize } from '@/lib/utils/format';
import { isSyncing, useMetaProfile, useProfileAssets } from '../meta-profiles/api';
import type { ProfileAdAccountDto } from '../meta-profiles/types';
import { adAccountsApi } from './api';

/**
 * Choose which discovered ad accounts of a Meta profile are connected (monitored, synced, usable for
 * launches). Changes are applied in one POST /ad-accounts/connect call.
 */
export function ConnectAccountsPanel({
  profileId,
  onSaved,
  className,
}: {
  profileId: string;
  onSaved?: () => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const profile = useMetaProfile(profileId);
  const assets = useProfileAssets(profileId);
  const accounts = useMemo(() => assets.data?.adAccounts ?? [], [assets.data]);
  const fingerprint = accounts.map((a) => `${a.metaAccountId}:${a.isConnected ? 1 : 0}`).join('|');
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> } | null>(null);
  const [query, setQuery] = useState('');

  const initial = useMemo(
    () => new Set(accounts.filter((a) => a.isConnected).map((a) => a.metaAccountId)),
    [accounts],
  );
  const selected = selection && selection.key === fingerprint ? selection.ids : initial;

  const toConnect = accounts
    .filter((a) => selected.has(a.metaAccountId) && !a.isConnected)
    .map((a) => a.metaAccountId);
  const toDisconnect = accounts
    .filter((a) => !selected.has(a.metaAccountId) && a.isConnected)
    .map((a) => a.metaAccountId);
  const dirty = toConnect.length + toDisconnect.length > 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.metaAccountId.includes(q.replace(/^act_/, '')) ||
        (a.metaBusinessName ?? '').toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const toggle = (account: ProfileAdAccountDto, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(account.metaAccountId);
    else next.delete(account.metaAccountId);
    setSelection({ key: fingerprint, ids: next });
  };

  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.metaAccountId));
  const toggleAll = (checked: boolean) => {
    const next = new Set(selected);
    for (const a of visible) {
      if (checked) next.add(a.metaAccountId);
      else next.delete(a.metaAccountId);
    }
    setSelection({ key: fingerprint, ids: next });
  };

  const save = useMutation({
    mutationFn: () => adAccountsApi.connect({ profileId, connect: toConnect, disconnect: toDisconnect }),
    onSuccess: async (res) => {
      const parts = [
        res.connected ? `${pluralize(res.connected, 'account')} connected` : null,
        res.disconnected ? `${pluralize(res.disconnected, 'account')} disconnected` : null,
      ].filter(Boolean);
      toast.success(parts.join(' · ') || 'No changes', {
        description: res.connected
          ? 'Pixels, audiences and campaigns of new accounts are being synchronised.'
          : undefined,
      });
      setSelection(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.metaProfiles.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts.all }),
      ]);
      onSaved?.();
    },
  });

  if (assets.isLoading) {
    return (
      <div className={cn('grid gap-2', className)}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (assets.isError)
    return <ErrorAlert error={assets.error} onRetry={() => void assets.refetch()} className={className} />;
  if (!accounts.length) {
    const syncing = isSyncing(profile.data);
    return (
      <EmptyState
        compact
        icon={syncing ? RefreshCw : Briefcase}
        title={syncing ? 'Discovering ad accounts…' : 'No ad accounts discovered'}
        description={
          syncing
            ? 'The profile is being synchronised with Meta. Accounts appear here as soon as the sync finishes.'
            : 'The token has no access to ad accounts yet, or the profile has not been synchronised. Run “Sync now” on the profile.'
        }
        className={className}
      />
    );
  }

  return (
    <div className={cn('grid gap-3', className)}>
      {accounts.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, id or business"
            className="h-8 pl-8 text-[13px]"
            aria-label="Filter ad accounts"
          />
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border">
        <label className="flex items-center gap-3 border-b bg-surface-subtle px-3 py-2 text-xs font-medium text-muted-foreground">
          <Checkbox
            checked={
              allVisibleSelected
                ? true
                : visible.some((a) => selected.has(a.metaAccountId))
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(v) => toggleAll(v === true)}
            aria-label="Select all ad accounts"
          />
          {pluralize(accounts.length, 'ad account')} discovered · {selected.size} selected
        </label>
        <ul className="max-h-[min(22rem,50vh)] divide-y overflow-y-auto">
          {visible.map((account) => {
            const checked = selected.has(account.metaAccountId);
            const changed = checked !== account.isConnected;
            return (
              <li key={account.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50',
                    changed && 'bg-primary/[0.04]',
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    onCheckedChange={(v) => toggle(account, v === true)}
                    aria-label={`Connect ${account.name}`}
                  />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-sm font-medium">{account.name}</span>
                      <AdAccountStatusBadge statusKey={account.statusKey} size="sm" />
                      {changed ? (
                        <span className="text-[11px] font-medium text-primary-fg">
                          {checked ? 'will connect' : 'will disconnect'}
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">act_{account.metaAccountId}</span> · {account.currency} ·{' '}
                      {account.timezoneName}
                      {account.metaBusinessName ? ` · ${account.metaBusinessName}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
          {!visible.length ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No accounts match “{query}”.
            </li>
          ) : null}
        </ul>
      </div>
      {save.isError ? <ErrorAlert error={save.error} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          {dirty
            ? [
                toConnect.length ? `${toConnect.length} to connect` : null,
                toDisconnect.length ? `${toDisconnect.length} to disconnect` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Connected accounts are monitored, synchronised and available for launches.'}
        </p>
        {dirty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelection(null)}
            disabled={save.isPending}
          >
            Reset
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => save.mutate()}
          disabled={!dirty}
          loading={save.isPending}
        >
          Save connections
        </Button>
      </div>
    </div>
  );
}
