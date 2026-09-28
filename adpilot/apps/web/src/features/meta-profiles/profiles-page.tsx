'use client';

import {
  CircleAlert,
  Ellipsis,
  Globe,
  KeyRound,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { MetaProfileStatusBadge } from '@/components/product/status';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/format';
import { humanize } from '@/lib/utils/strings';
import { isSyncing, useMetaProfiles } from './api';
import { DeleteProfileDialog, useProfileActions, useProfileDialog } from './actions';
import { ProfileDialog } from './profile-dialog';
import type { MetaProfileDto } from './types';

const WEEK = 7 * 86400_000;

export function TokenExpiry({
  profile,
  now,
}: {
  profile: Pick<MetaProfileDto, 'tokenExpiresAt' | 'status'>;
  now: number;
}) {
  if (!profile.tokenExpiresAt) {
    return <span className="text-muted-foreground">{profile.status === 'ACTIVE' ? 'Never' : '—'}</span>;
  }
  const left = new Date(profile.tokenExpiresAt).getTime() - now;
  return (
    <span
      className={cn(
        'flex flex-col',
        left < 0 ? 'text-destructive-fg' : left < WEEK ? 'text-warning-fg' : undefined,
      )}
    >
      <span>{formatDate(profile.tokenExpiresAt)}</span>
      <RelativeTime value={profile.tokenExpiresAt} className="text-xs text-muted-foreground" />
    </span>
  );
}

export function ProfilesPage() {
  const router = useRouter();
  const profiles = useMetaProfiles();
  const [createOpen, setCreateOpen] = useState(false);
  const dialog = useProfileDialog();
  const actions = useProfileActions();
  const now = useNow(60_000);

  const columns: DataTableColumn<MetaProfileDto>[] = [
    {
      id: 'name',
      header: 'Profile',
      cell: (p) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/meta-profiles/${p.id}`} className="truncate font-medium hover:underline">
            {p.name}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {p.metaUserName ? `Meta user ${p.metaUserName}` : (p.notes ?? 'Not validated yet')}
          </span>
        </div>
      ),
      interactive: true,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MetaProfileStatusBadge status={p.status} />
          {!p.isEnabled ? <Badge variant="muted">Disabled</Badge> : null}
          {p.lastValidationError && p.status !== 'ACTIVE' ? (
            <SimpleTooltip content={p.lastValidationError}>
              <CircleAlert className="size-4 text-destructive-fg" aria-label={p.lastValidationError} />
            </SimpleTooltip>
          ) : null}
        </div>
      ),
    },
    {
      id: 'token',
      header: 'Token',
      cell: (p) => (
        <div className="grid gap-0.5">
          <span className="font-mono text-xs">{p.tokenMask}</span>
          <span className="text-xs text-muted-foreground">{humanize(p.tokenType)}</span>
        </div>
      ),
    },
    { id: 'expires', header: 'Expires', cell: (p) => <TokenExpiry profile={p} now={now} /> },
    {
      id: 'proxy',
      header: 'Network',
      cell: (p) =>
        p.proxy ? (
          <div className="grid gap-0.5">
            <span className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  p.proxy.lastTestOk === true
                    ? 'bg-success'
                    : p.proxy.lastTestOk === false
                      ? 'bg-destructive'
                      : 'bg-muted-foreground/50',
                )}
              />
              {p.proxy.type} proxy
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {p.proxy.host}:{p.proxy.port}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">Direct</span>
        ),
    },
    {
      id: 'assets',
      header: 'Ad accounts',
      align: 'right',
      cell: (p) => (
        <div className="grid justify-items-end gap-0.5 tabular-nums">
          <span>
            {p.counts.connectedAdAccounts}
            <span className="text-muted-foreground"> / {p.counts.adAccounts}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {p.counts.pages} {p.counts.pages === 1 ? 'page' : 'pages'}
          </span>
        </div>
      ),
    },
    {
      id: 'sync',
      header: 'Last sync',
      cell: (p) => (
        <div className="grid gap-0.5">
          {isSyncing(p) || p.syncStatus === 'FAILED' ? <StatusBadge status={p.syncStatus} size="sm" /> : null}
          {p.lastSyncAt ? (
            <RelativeTime value={p.lastSyncAt} className="text-xs text-muted-foreground" />
          ) : (
            <span className="text-xs text-muted-foreground">Never</span>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      interactive: true,
      cell: (p) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => router.push(`/meta-profiles/${p.id}`)}>
              <Plug />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dialog.open('edit', p)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.validate.mutate(p)}>
              <ShieldCheck />
              Validate token
            </DropdownMenuItem>
            {p.proxy ? (
              <DropdownMenuItem onSelect={() => actions.testProxy.mutate(p)}>
                <Globe />
                Test proxy
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={p.status !== 'ACTIVE' || isSyncing(p)}
              onSelect={() => actions.sync.mutate(p)}
            >
              <RefreshCw />
              Sync now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => dialog.open('delete', p)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Meta accounts"
        description="Meta profiles hold an access token and an optional proxy. Their Business Managers, ad accounts, pages and pixels are discovered automatically."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Add profile
          </Button>
        }
      />
      <DataTable
        aria-label="Meta profiles"
        columns={columns}
        data={profiles.data}
        getRowId={(p) => p.id}
        isLoading={profiles.isLoading}
        isFetching={profiles.isFetching}
        error={profiles.error}
        onRetry={() => void profiles.refetch()}
        onRowClick={(p) => router.push(`/meta-profiles/${p.id}`)}
        minWidth={900}
        emptyState={
          <EmptyState
            icon={KeyRound}
            title="No Meta profiles yet"
            description="Add an access token with the ads_management and ads_read permissions. You can route its traffic through an HTTP, HTTPS or SOCKS5 proxy."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Add your first profile
              </Button>
            }
          />
        }
      />
      <ProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(res) => router.push(`/meta-profiles/${res.profile.id}`)}
      />
      <ProfileDialog
        open={dialog.state?.kind === 'edit'}
        onOpenChange={(open) => !open && dialog.close()}
        profile={dialog.state?.kind === 'edit' ? dialog.state.profile : undefined}
      />
      {dialog.state?.kind === 'delete' ? (
        <DeleteProfileDialog
          profile={dialog.state.profile}
          open
          onOpenChange={(open) => !open && dialog.close()}
        />
      ) : null}
    </>
  );
}
