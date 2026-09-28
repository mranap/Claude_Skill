'use client';

import { SYSTEM_ROLES, type PermissionKey } from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Briefcase,
  Ellipsis,
  FileImage,
  KeyRound,
  LogOut,
  Megaphone,
  Pencil,
  Plug,
  Rocket,
  Send,
  ShieldCheck,
  ShieldOff,
  Trash,
  UserCheck,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { useAuth } from '@/features/auth/auth-context';
import { loginEventColumns } from '@/features/account/login-events';
import { SessionList } from '@/features/account/session-list';
import { isApiError } from '@/lib/api/errors';
import { useNow } from '@/lib/hooks/use-now';
import { queryKeys } from '@/lib/api/query-keys';
import type { AdminUserDetail, SessionDto } from '@/lib/api/types';
import { formatBytes, formatDateTime, formatNumber } from '@/lib/utils/format';
import { adminUsersApi } from './api';
import { isPrivilegedRole, useAdminUser, useRoles } from './hooks';
import { EditUserDialog, ResetPasswordDialog } from './user-action-dialogs';

type Dialog =
  | { kind: 'edit' }
  | { kind: 'block' }
  | { kind: 'unblock' }
  | { kind: 'reset-password' }
  | { kind: 'reset-2fa' }
  | { kind: 'revoke-all' }
  | { kind: 'revoke-one'; session: SessionDto }
  | { kind: 'delete' };

function UsageTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg leading-6 font-semibold tabular-nums">{formatNumber(value)}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function UserDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: me, can, isSuperAdmin } = useAuth();
  const query = useAdminUser(id);
  const roles = useRoles();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [reason, setReason] = useState('');
  const now = useNow(60_000);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.detail(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all }),
    ]);

  const revokeOne = useMutation({
    mutationFn: (sessionId: string) => adminUsersApi.revokeSession(id, sessionId),
    onSuccess: () => toast.success('Session signed out'),
    onSettled: refresh,
  });

  if (query.isPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (query.error) {
    return (
      <>
        <PageHeader title="User" breadcrumbs={[{ label: 'Users', href: '/admin/users' }, { label: 'Details' }]} />
        {isApiError(query.error, 'NOT_FOUND') ? (
          <Card>
            <EmptyState
              title="User not found"
              description="The user may have been removed, or the link is wrong."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/users">Back to users</Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <ErrorAlert error={query.error} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }

  const user: AdminUserDetail = query.data;
  const isSelf = user.id === me.id;
  const deleted = user.status === 'DELETED';
  const targetRole = roles.data?.find((r) => r.id === user.role.id);
  const targetPrivileged = user.role.key === SYSTEM_ROLES.SUPER_ADMIN || isPrivilegedRole(targetRole);
  const protectedTarget = targetPrivileged && !isSuperAdmin && !isSelf;
  const allowed = (permission: PermissionKey) => can(permission) && !protectedTarget && !deleted;
  const locked = !!user.lockedUntil && new Date(user.lockedUntil).getTime() > now;

  const used = Number(user.storageUsedBytes);
  const quota = user.storageQuotaBytes ? Number(user.storageQuotaBytes) : null;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;

  const run = async (action: () => Promise<unknown>, success: string) => {
    await action();
    toast.success(success);
    await refresh();
  };

  const menuItems: { key: string; label: string; icon: React.ElementType; onSelect: () => void; show: boolean; destructive?: boolean }[] = [
    { key: 'edit', label: 'Edit profile & role', icon: Pencil, onSelect: () => setDialog({ kind: 'edit' }), show: allowed('admin.users.update') },
    {
      key: 'block',
      label: user.status === 'BLOCKED' ? 'Unblock user' : 'Block user',
      icon: user.status === 'BLOCKED' ? UserCheck : Ban,
      onSelect: () => setDialog({ kind: user.status === 'BLOCKED' ? 'unblock' : 'block' }),
      show: allowed('admin.users.block') && !isSelf,
      destructive: user.status !== 'BLOCKED',
    },
    { key: 'reset-password', label: 'Reset password', icon: KeyRound, onSelect: () => setDialog({ kind: 'reset-password' }), show: allowed('admin.users.reset_password') },
    {
      key: 'reset-2fa',
      label: 'Reset two-factor auth',
      icon: ShieldOff,
      onSelect: () => setDialog({ kind: 'reset-2fa' }),
      show: allowed('admin.users.reset_password') && user.twoFactorEnabled,
    },
    {
      key: 'revoke-all',
      label: 'Sign out all sessions',
      icon: LogOut,
      onSelect: () => setDialog({ kind: 'revoke-all' }),
      show: allowed('admin.users.sessions') && user.sessions.length > 0,
    },
  ];
  const canDelete = allowed('admin.users.delete') && !isSelf;
  const visibleItems = menuItems.filter((i) => i.show);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', href: '/admin/users' }, { label: user.email }]}
        title={
          <span className="flex items-center gap-3">
            <UserAvatar name={user.name} email={user.email} seed={user.id} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{user.name || user.email.split('@')[0]}</span>
              <span className="block truncate text-sm font-normal text-muted-foreground">{user.email}</span>
            </span>
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-1.5 sm:ml-2">
            <StatusBadge status={user.status} />
            <Badge variant={targetPrivileged ? 'default' : 'secondary'}>{user.role.name}</Badge>
            {user.twoFactorEnabled ? (
              <Badge variant="success">
                <ShieldCheck />
                2FA
              </Badge>
            ) : null}
            {isSelf ? <Badge variant="outline">You</Badge> : null}
          </span>
        }
        actions={
          <>
            {allowed('admin.users.update') ? (
              <Button variant="outline" onClick={() => setDialog({ kind: 'edit' })}>
                <Pencil />
                Edit
              </Button>
            ) : null}
            {visibleItems.length || canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Manage user</DropdownMenuLabel>
                  {visibleItems.map((item) => (
                    <DropdownMenuItem key={item.key} onSelect={item.onSelect} variant={item.destructive ? 'destructive' : 'default'}>
                      <item.icon />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                  {canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete' })}>
                        <Trash />
                        Delete user
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <div className="mb-6 grid gap-3 empty:hidden">
        {protectedTarget ? (
          <Alert variant="info">
            <AlertTitle>Administrator account</AlertTitle>
            <AlertDescription>Only a Super Admin can change, block or delete users with administrative roles.</AlertDescription>
          </Alert>
        ) : null}
        {user.status === 'BLOCKED' ? (
          <Alert variant="destructive">
            <AlertTitle>Blocked {user.blockedAt ? `on ${formatDateTime(user.blockedAt)}` : ''}</AlertTitle>
            <AlertDescription>
              <p>{user.blockedReason ? `Reason: ${user.blockedReason}` : 'No reason was given.'}</p>
              <p>The user cannot sign in until an administrator unblocks the account.</p>
            </AlertDescription>
          </Alert>
        ) : null}
        {deleted ? (
          <Alert>
            <AlertTitle>Deleted account</AlertTitle>
            <AlertDescription>
              Deleted {user.deletedAt ? formatDateTime(user.deletedAt) : ''}. Secrets were destroyed; the record is kept for the audit trail.
            </AlertDescription>
          </Alert>
        ) : null}
        {locked ? (
          <Alert variant="warning">
            <AlertTitle>Temporarily locked</AlertTitle>
            <AlertDescription>Too many failed sign-ins. The lock ends {formatDateTime(user.lockedUntil)}; unblocking clears it.</AlertDescription>
          </Alert>
        ) : null}
        {user.mustChangePassword && !deleted ? (
          <Alert variant="info">
            <AlertTitle>Temporary password</AlertTitle>
            <AlertDescription>The user must choose a new password at the next sign-in.</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Usage</CardTitle>
              <CardDescription>Resources owned by this user.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <UsageTile icon={Plug} label="Meta profiles" value={user._count.metaProfiles} />
                <UsageTile icon={Briefcase} label="Ad accounts" value={user._count.adAccounts} />
                <UsageTile icon={Megaphone} label="Campaigns" value={user._count.campaigns} />
                <UsageTile icon={FileImage} label="Creatives" value={user._count.creativeFiles} />
                <UsageTile icon={Workflow} label="Auto rules" value={user._count.autoRules} />
                <UsageTile icon={Rocket} label="Launch jobs" value={user._count.launchJobs} />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Storage</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatBytes(user.storageUsedBytes)} of {quota ? formatBytes(quota) : 'platform default'}
                  </span>
                </div>
                <Progress value={quota ? pct : 0} tone={pct > 90 ? 'danger' : pct > 75 ? 'warning' : 'default'} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
              <CardDescription>{user.sessions.length ? `${user.sessions.length} signed-in device${user.sessions.length === 1 ? '' : 's'}.` : 'Not signed in anywhere.'}</CardDescription>
              {allowed('admin.users.sessions') && user.sessions.length ? (
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'revoke-all' })}>
                    <LogOut />
                    Sign out all
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <SessionList
                sessions={user.sessions}
                canRevoke={allowed('admin.users.sessions')}
                onRevoke={(session) => setDialog({ kind: 'revoke-one', session })}
                revokingId={revokeOne.isPending ? revokeOne.variables : null}
                empty={<p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No active sessions.</p>}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent sign-ins</CardTitle>
              <CardDescription>The last 20 sign-in attempts, including failed ones.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                aria-label="Recent sign-ins"
                columns={loginEventColumns}
                data={user.recentLogins}
                getRowId={(e) => e.id}
                stickyHeader={false}
                minWidth={620}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueList
                items={[
                  { label: 'Email', value: user.email, copy: user.email },
                  { label: 'Name', value: user.name },
                  { label: 'Role', value: user.role.name },
                  { label: 'Time zone', value: user.timezone },
                  { label: 'Created', value: formatDateTime(user.createdAt) },
                  { label: 'Last sign-in', value: user.lastLoginAt ? <RelativeTime value={user.lastLoginAt} /> : 'Never' },
                  { label: 'Last IP', value: user.lastLoginIp, mono: true },
                  { label: '2FA', value: user.twoFactorEnabled ? 'Enabled' : 'Disabled' },
                  { label: 'User ID', value: <span className="text-xs">{user.id}</span>, mono: true, copy: user.id },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="size-4 text-muted-foreground" />
                Telegram
              </CardTitle>
            </CardHeader>
            <CardContent>
              {user.telegramConnection ? (
                <KeyValueList
                  items={[
                    {
                      label: 'Status',
                      value: user.telegramConnection.isActive ? <Badge variant="success">Connected</Badge> : <Badge variant="warning">Inactive</Badge>,
                    },
                    { label: 'Username', value: user.telegramConnection.username ? `@${user.telegramConnection.username}` : null },
                    { label: 'Linked', value: formatDateTime(user.telegramConnection.linkedAt) },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Telegram is not connected.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog?.kind === 'edit' ? (
        <EditUserDialog
          user={user}
          roles={roles.data}
          isSelf={isSelf}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            queryClient.setQueryData(queryKeys.admin.users.detail(id), updated);
            void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
            void queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles });
          }}
        />
      ) : null}
      {dialog?.kind === 'reset-password' ? (
        <ResetPasswordDialog user={user} onClose={() => setDialog(null)} onDone={() => void refresh()} />
      ) : null}

      <ConfirmDialog
        open={dialog?.kind === 'block'}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setReason('');
          }
        }}
        title={`Block ${user.email}?`}
        description="The user is signed out of every session and cannot sign in until unblocked. Their data and campaigns are not changed."
        confirmLabel="Block user"
        destructive
        onConfirm={() => run(() => adminUsersApi.block(user.id, reason.trim() || undefined), 'User blocked')}
      >
        <Textarea
          placeholder="Reason (optional, visible to administrators)"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-16"
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === 'unblock'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Unblock ${user.email}?`}
        description="The user can sign in again. Failed sign-in counters and temporary locks are cleared."
        confirmLabel="Unblock user"
        onConfirm={() => run(() => adminUsersApi.unblock(user.id), 'User unblocked')}
      />
      <ConfirmDialog
        open={dialog?.kind === 'reset-2fa'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Reset two-factor authentication?"
        description="2FA is turned off and all sessions are signed out. The user can enable it again from Settings → Security."
        confirmLabel="Reset 2FA"
        destructive
        onConfirm={() => run(() => adminUsersApi.reset2fa(user.id), 'Two-factor authentication reset')}
      />
      <ConfirmDialog
        open={dialog?.kind === 'revoke-all'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Sign out all sessions?"
        description={`Every device signed in as ${user.email} is signed out immediately.`}
        confirmLabel="Sign out all"
        destructive
        onConfirm={() => run(() => adminUsersApi.revokeAllSessions(user.id), 'All sessions signed out')}
      />
      <ConfirmDialog
        open={dialog?.kind === 'revoke-one'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Sign out this session?"
        description="The device will need to sign in again."
        confirmLabel="Sign out session"
        destructive
        onConfirm={() => (dialog?.kind === 'revoke-one' ? revokeOne.mutateAsync(dialog.session.id) : undefined)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Delete ${user.email}?`}
        description={
          <div className="space-y-2">
            <p>The account is deactivated permanently and everything secret it owns is destroyed:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>Meta access tokens and app secrets</li>
              <li>Proxy passwords</li>
              <li>All active sessions</li>
              <li>Telegram links and one-time reset / e-mail tokens</li>
              <li>Two-factor authentication data</li>
            </ul>
            <p>Ad accounts are disconnected and running launch jobs are cancelled. Records stay in the audit trail. This cannot be undone.</p>
          </div>
        }
        confirmText={user.email}
        confirmLabel="Delete user"
        destructive
        onConfirm={async () => {
          await adminUsersApi.remove(user.id);
          toast.success('User deleted');
          await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
          router.push('/admin/users');
        }}
      />
    </>
  );
}
