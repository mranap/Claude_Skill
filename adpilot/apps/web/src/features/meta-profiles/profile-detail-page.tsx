'use client';

import { META_REQUIRED_PERMISSIONS, type TokenInspection } from '@adpilot/shared';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { Building2, CircleAlert, Ellipsis, FileText, Globe, KeyRound, Pencil, Power, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { MetaId } from '@/components/product/meta-id';
import { MetaProfileStatusBadge } from '@/components/product/status';
import { getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useNow } from '@/lib/hooks/use-now';
import { formatDateTime, formatDurationMs } from '@/lib/utils/format';
import { humanize } from '@/lib/utils/strings';
import { adAccountsApi } from '../ad-accounts/api';
import { ConnectAccountsPanel } from '../ad-accounts/connect-accounts';
import { isSyncing, metaProfilesApi, useMetaProfile, useProfileAssets } from './api';
import { DeleteProfileDialog, useProfileActions } from './actions';
import { ScopeList, TokenInspectionResult, expiryText } from './inspection';
import { ProfileDialog } from './profile-dialog';
import type { MetaProfileDto, ProfileAdAccountDto } from './types';

const WEEK = 7 * 86400_000;

export function ProfileDetailPage({ id }: { id: string }) {
  const profile = useMetaProfile(id);
  if (profile.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <>
        <PageHeader title="Meta profile" breadcrumbs={[{ label: 'Meta accounts', href: '/meta-profiles' }, { label: 'Not available' }]} />
        <ErrorAlert error={profile.error} onRetry={() => void profile.refetch()} />
      </>
    );
  }
  return <ProfileDetail profile={profile.data} />;
}

function ProfileDetail({ profile }: { profile: MetaProfileDto }) {
  const queryClient = useQueryClient();
  const actions = useProfileActions();
  const now = useNow(60_000);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [check, setCheck] = useState<TokenInspection | null>(null);
  const assets = useProfileAssets(profile.id);
  const syncing = isSyncing(profile);

  // Refresh the discovered assets once a running sync finishes.
  const wasSyncing = useRef(syncing);
  useEffect(() => {
    if (wasSyncing.current && !syncing) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.metaProfiles.assets(profile.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts.all });
    }
    wasSyncing.current = syncing;
  }, [syncing, profile.id, queryClient]);

  const toggleEnabled = useMutation({
    mutationFn: () => metaProfilesApi.update(profile.id, { isEnabled: !profile.isEnabled }),
    onSuccess: async (res) => {
      queryClient.setQueryData(queryKeys.metaProfiles.detail(profile.id), res.profile);
      toast.success(res.profile.isEnabled ? 'Profile enabled' : 'Profile disabled', {
        description: res.profile.isEnabled ? undefined : 'Its ad accounts are no longer used for launches, syncs and rules.',
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.metaProfiles.all });
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const validate = () =>
    actions.validate.mutate(profile, {
      onSuccess: (inspection) => setCheck(inspection),
    });

  const missingRequired = profile.tokenScopes.length ? META_REQUIRED_PERMISSIONS.filter((p) => !profile.tokenScopes.includes(p)) : [];
  const expiresIn = profile.tokenExpiresAt ? new Date(profile.tokenExpiresAt).getTime() - now : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Meta accounts', href: '/meta-profiles' }, { label: profile.name }]}
        title={profile.name}
        meta={
          <>
            <MetaProfileStatusBadge status={profile.status} />
            {!profile.isEnabled ? <Badge variant="muted">Disabled</Badge> : null}
          </>
        }
        description={
          <>
            {profile.metaUserName ? `Meta user ${profile.metaUserName} · ` : ''}
            <span className="font-mono">{profile.tokenMask}</span>
            {profile.notes ? ` · ${profile.notes}` : ''}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={validate} loading={actions.validate.isPending}>
              <ShieldCheck />
              Validate token
            </Button>
            <Button variant="outline" onClick={() => actions.sync.mutate(profile)} loading={actions.sync.isPending} disabled={syncing || profile.status !== 'ACTIVE'}>
              <RefreshCw className={syncing ? 'animate-spin' : undefined} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {profile.proxy ? (
                  <DropdownMenuItem onSelect={() => actions.testProxy.mutate(profile)}>
                    <Globe />
                    Test proxy
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => toggleEnabled.mutate()}>
                  <Power />
                  {profile.isEnabled ? 'Disable profile' : 'Enable profile'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 />
                  Delete profile
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="grid gap-4">
        {profile.status !== 'ACTIVE' && profile.status !== 'UNCHECKED' ? (
          <Alert variant="destructive" icon={<CircleAlert />}>
            <AlertTitle>{profile.statusLabel}</AlertTitle>
            <AlertDescription>
              {profile.lastValidationError ?? 'The token cannot be used right now.'} Replace the token to resume syncs, launches and rules.
              <Button size="xs" variant="outline" className="mt-2 w-fit" onClick={() => setEditOpen(true)}>
                Replace token
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {profile.status === 'ACTIVE' && expiresIn !== null && expiresIn < WEEK ? (
          <Alert variant="warning" icon={<KeyRound />}>
            <AlertTitle>The token expires soon</AlertTitle>
            <AlertDescription>It expires {expiryText(profile.tokenExpiresAt)}. Generate a new token and replace it before then.</AlertDescription>
          </Alert>
        ) : null}
        {missingRequired.length && profile.status === 'ACTIVE' ? (
          <Alert variant="destructive" icon={<KeyRound />}>
            <AlertTitle>Missing required permissions</AlertTitle>
            <AlertDescription>{missingRequired.join(', ')} — campaigns cannot be created or read without them.</AlertDescription>
          </Alert>
        ) : null}
        {profile.syncStatus === 'FAILED' && profile.syncError ? (
          <Alert variant="warning" icon={<RefreshCw />}>
            <AlertTitle>The last synchronisation failed</AlertTitle>
            <AlertDescription>{profile.syncError}</AlertDescription>
          </Alert>
        ) : null}
        {check ? (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="grid gap-1">
                <CardTitle>Token check</CardTitle>
                <CardDescription>Result of the validation you just ran.</CardDescription>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setCheck(null)} aria-label="Dismiss the token check">
                <X />
              </Button>
            </CardHeader>
            <CardContent>
              <TokenInspectionResult inspection={check} />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Access token</CardTitle>
              <CardDescription>Stored encrypted; only the masked form is shown.</CardDescription>
            </CardHeader>
            <CardContent>
              <KeyValueList
                items={[
                  { label: 'Token', value: profile.tokenMask, mono: true },
                  { label: 'Type', value: humanize(profile.tokenType) },
                  { label: 'Expires', value: profile.lastValidatedAt ? expiryText(profile.tokenExpiresAt, profile.status === 'ACTIVE') : 'Not checked yet' },
                  { label: 'Data access expires', value: profile.dataAccessExpiresAt ? expiryText(profile.dataAccessExpiresAt) : null, hidden: !profile.dataAccessExpiresAt },
                  { label: 'Meta user', value: profile.metaUserName ? `${profile.metaUserName}${profile.metaUserId ? ` · ${profile.metaUserId}` : ''}` : null },
                  { label: 'App', value: profile.appId ?? profile.tokenAppId, mono: true },
                  { label: 'App secret', value: profile.hasAppSecret ? 'Saved (appsecret_proof enabled)' : 'Not set' },
                  { label: 'Last validated', value: profile.lastValidatedAt ? <RelativeTime value={profile.lastValidatedAt} /> : 'Never' },
                ]}
              />
              {profile.tokenScopes.length ? (
                <div className="mt-4 grid gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Permissions</p>
                  <ScopeList scopes={profile.tokenScopes} missingRequired={missingRequired} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Network route</CardTitle>
              <CardDescription>{profile.proxy ? 'Every Meta API call of this profile goes through this proxy.' : 'Meta is called directly from the server.'}</CardDescription>
            </CardHeader>
            <CardContent>
              {profile.proxy ? (
                <>
                  <KeyValueList
                    items={[
                      { label: 'Type', value: profile.proxy.type },
                      { label: 'Address', value: `${profile.proxy.host}:${profile.proxy.port}`, mono: true },
                      { label: 'Username', value: profile.proxy.username },
                      { label: 'Password', value: profile.proxy.hasPassword ? 'Saved' : 'None' },
                      {
                        label: 'Last test',
                        value: profile.proxy.lastTestAt ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={profile.proxy.lastTestOk ? 'SUCCESS' : 'FAILED'} label={profile.proxy.lastTestOk ? 'Working' : 'Failed'} size="sm" />
                            <RelativeTime value={profile.proxy.lastTestAt} className="text-xs text-muted-foreground" />
                            {profile.proxy.lastTestLatencyMs !== null ? (
                              <span className="text-xs text-muted-foreground">· {formatDurationMs(profile.proxy.lastTestLatencyMs)}</span>
                            ) : null}
                          </span>
                        ) : (
                          'Never tested'
                        ),
                      },
                    ]}
                  />
                  {profile.proxy.lastTestError ? <p className="mt-3 text-xs text-destructive-fg">{profile.proxy.lastTestError}</p> : null}
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => actions.testProxy.mutate(profile)} loading={actions.testProxy.isPending}>
                    <Globe />
                    Test proxy
                  </Button>
                </>
              ) : (
                <EmptyState compact icon={Globe} title="Direct connection" description="Add an HTTP, HTTPS or SOCKS5 proxy in the profile settings if this token must use a fixed IP." className="py-4" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Synchronisation</CardTitle>
              <CardDescription>Businesses, ad accounts, pages and pixels are refreshed automatically.</CardDescription>
            </CardHeader>
            <CardContent>
              <KeyValueList
                items={[
                  { label: 'Status', value: <StatusBadge status={profile.syncStatus} /> },
                  { label: 'Last sync', value: profile.lastSyncAt ? `${formatDateTime(profile.lastSyncAt)}` : 'Never' },
                  { label: 'Business Managers', value: profile.counts.businesses },
                  { label: 'Ad accounts', value: `${profile.counts.connectedAdAccounts} connected of ${profile.counts.adAccounts}` },
                  { label: 'Pages', value: profile.counts.pages },
                  { label: 'Added', value: formatDateTime(profile.createdAt) },
                ]}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Discovered assets</CardTitle>
            <CardDescription>Choose which ad accounts are connected: only connected accounts are monitored, synchronised and available for launches.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="accounts">
              <TabsList className="mb-4">
                <TabsTrigger value="accounts">Ad accounts ({assets.data?.adAccounts.length ?? profile.counts.adAccounts})</TabsTrigger>
                <TabsTrigger value="pages">Pages ({assets.data?.pages.length ?? profile.counts.pages})</TabsTrigger>
                <TabsTrigger value="businesses">Businesses ({assets.data?.businesses.length ?? profile.counts.businesses})</TabsTrigger>
                <TabsTrigger value="pixels">Pixels</TabsTrigger>
              </TabsList>
              <TabsContent value="accounts">
                <ConnectAccountsPanel profileId={profile.id} />
              </TabsContent>
              <TabsContent value="pages">
                {assets.data?.pages.length ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table className="min-w-[560px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Page</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Instagram</TableHead>
                          <TableHead>Synced</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assets.data.pages.map((page) => (
                          <TableRow key={page.id}>
                            <TableCell>
                              <div className="grid gap-0.5">
                                <span className="font-medium">{page.name}</span>
                                <MetaId value={page.metaPageId} />
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{page.category ?? '—'}</TableCell>
                            <TableCell>{page.instagramUsername ? `@${page.instagramUsername}` : <span className="text-muted-foreground">Not linked</span>}</TableCell>
                            <TableCell>
                              <RelativeTime value={page.lastSyncedAt} className="text-xs text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState compact icon={FileText} title="No pages discovered" description="Pages appear here when the token has pages_show_list and the profile has been synchronised." />
                )}
              </TabsContent>
              <TabsContent value="businesses">
                {assets.data?.businesses.length ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table className="min-w-[480px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Business Manager</TableHead>
                          <TableHead>Verification</TableHead>
                          <TableHead>Synced</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assets.data.businesses.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell>
                              <div className="grid gap-0.5">
                                <span className="font-medium">{b.name}</span>
                                <MetaId value={b.metaBusinessId} />
                              </div>
                            </TableCell>
                            <TableCell>{b.verificationStatus ? humanize(b.verificationStatus) : '—'}</TableCell>
                            <TableCell>
                              <RelativeTime value={b.lastSyncedAt} className="text-xs text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState compact icon={Building2} title="No Business Managers" description="Business Managers are listed when the token has business_management." />
                )}
              </TabsContent>
              <TabsContent value="pixels">
                <ProfilePixels accounts={(assets.data?.adAccounts ?? []).filter((a) => a.isConnected)} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <ProfileDialog open={editOpen} onOpenChange={setEditOpen} profile={profile} />
      <DeleteProfileDialog profile={profile} open={deleteOpen} onOpenChange={setDeleteOpen} redirectTo="/meta-profiles" />
    </>
  );
}

/** Pixels are synchronised per connected ad account; this merges them for the profile view. */
function ProfilePixels({ accounts }: { accounts: ProfileAdAccountDto[] }) {
  const results = useQueries({
    queries: accounts.map((a) => ({
      queryKey: queryKeys.adAccounts.pixels(a.id),
      queryFn: () => adAccountsApi.pixels(a.id),
      staleTime: 60_000,
    })),
  });
  if (!accounts.length) {
    return <EmptyState compact icon={FileText} title="No connected ad accounts" description="Pixels are read from connected ad accounts. Connect an account on the first tab." />;
  }
  if (results.some((r) => r.isLoading)) return <Skeleton className="h-24" />;
  const failed = results.find((r) => r.isError);
  if (failed) return <ErrorAlert error={failed.error} />;
  const rows = results.flatMap((r, i) => (r.data ?? []).map((pixel) => ({ pixel, account: accounts[i]! })));
  if (!rows.length) return <EmptyState compact icon={FileText} title="No pixels shared with the connected ad accounts" />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            <TableHead>Pixel / dataset</TableHead>
            <TableHead>Ad account</TableHead>
            <TableHead>Last event</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ pixel, account }) => (
            <TableRow key={pixel.id}>
              <TableCell>
                <div className="grid gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {pixel.name}
                    {pixel.isUnavailable ? <Badge variant="warning" size="sm">Unavailable</Badge> : null}
                  </span>
                  <MetaId value={pixel.metaPixelId} />
                </div>
              </TableCell>
              <TableCell>
                <Link href={`/ad-accounts/${account.id}`} className="hover:underline">
                  {account.name}
                </Link>
              </TableCell>
              <TableCell>{pixel.lastFiredTime ? <RelativeTime value={pixel.lastFiredTime} /> : <span className="text-muted-foreground">No events yet</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
