'use client';

import { SYSTEM_ROLES } from '@adpilot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Ellipsis, Eye, Mail, ShieldCheck, UserCheck, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { AdminUserListItem } from '@/lib/api/types';
import { formatBytes, formatDate, formatNumber } from '@/lib/utils/format';
import { adminUsersApi } from './api';
import { CreateUserDialog } from './create-user-dialog';
import { useAdminUsers, useRoles } from './hooks';

const FILTERS = ['status', 'roleId'] as const;

function Count({ value }: { value: number }) {
  return <span className={value ? 'tabular-nums' : 'text-muted-foreground tabular-nums'}>{formatNumber(value)}</span>;
}

type BulkAction = { kind: 'block' | 'unblock'; users: AdminUserListItem[]; clear: () => void };

export function UsersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: me, can } = useAuth();
  const table = useUrlTableState({ filterKeys: FILTERS, defaultSort: 'createdAt:desc' });
  const users = useAdminUsers(table.params);
  const roles = useRoles();
  const [createOpen, setCreateOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [rowAction, setRowAction] = useState<{ kind: 'block' | 'unblock'; user: AdminUserListItem } | null>(null);

  const canBlock = can('admin.users.block');

  const runBulk = async (action: BulkAction) => {
    let ok = 0;
    const failures: string[] = [];
    for (const u of action.users) {
      try {
        if (action.kind === 'block') await adminUsersApi.block(u.id, blockReason.trim() || undefined);
        else await adminUsersApi.unblock(u.id);
        ok++;
      } catch (err) {
        failures.push(`${u.email}: ${getErrorMessage(err)}`);
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
    action.clear();
    const verb = action.kind === 'block' ? 'blocked' : 'unblocked';
    if (ok) toast.success(`${ok} user${ok === 1 ? '' : 's'} ${verb}`);
    if (failures.length) {
      toast.error(`${failures.length} user${failures.length === 1 ? '' : 's'} could not be ${verb}`, {
        description: failures.slice(0, 3).join('\n'),
      });
    }
  };

  const columns: DataTableColumn<AdminUserListItem>[] = [
    {
      id: 'user',
      header: 'User',
      sortField: 'email',
      cell: (u) => (
        <div className="flex min-w-52 items-center gap-3">
          <UserAvatar name={u.name} email={u.email} seed={u.id} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {u.name || u.email.split('@')[0]}
              {u.id === me.id ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (u) => (
        <Badge variant={u.role.key === SYSTEM_ROLES.SUPER_ADMIN || u.role.key === SYSTEM_ROLES.ADMIN ? 'default' : 'secondary'}>
          {u.role.name}
        </Badge>
      ),
    },
    { id: 'status', header: 'Status', sortField: 'status', cell: (u) => <StatusBadge status={u.status} /> },
    {
      id: '2fa',
      header: '2FA',
      align: 'center',
      cell: (u) =>
        u.twoFactorEnabled ? (
          <SimpleTooltip content="Two-factor authentication enabled">
            <ShieldCheck className="mx-auto size-4 text-success-fg" aria-label="2FA enabled" />
          </SimpleTooltip>
        ) : (
          <span className="text-muted-foreground" aria-label="2FA disabled">—</span>
        ),
    },
    { id: 'profiles', header: 'Profiles', align: 'right', cell: (u) => <Count value={u.usage.metaProfiles} /> },
    { id: 'adAccounts', header: 'Ad accts', align: 'right', cell: (u) => <Count value={u.usage.adAccounts} /> },
    { id: 'campaigns', header: 'Campaigns', align: 'right', cell: (u) => <Count value={u.usage.campaigns} /> },
    { id: 'files', header: 'Files', align: 'right', cell: (u) => <Count value={u.usage.files} /> },
    {
      id: 'storage',
      header: 'Storage',
      align: 'right',
      cell: (u) => (
        <span className={u.usage.storageBytes === '0' ? 'text-muted-foreground tabular-nums' : 'tabular-nums'}>
          {formatBytes(u.usage.storageBytes)}
        </span>
      ),
    },
    {
      id: 'lastLogin',
      header: 'Last login',
      sortField: 'lastLoginAt',
      cell: (u) => <RelativeTime value={u.lastLoginAt} fallback="Never" className="text-muted-foreground" />,
    },
    {
      id: 'created',
      header: 'Created',
      sortField: 'createdAt',
      cell: (u) => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{formatDate(u.createdAt)}</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      interactive: true,
      cell: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${u.email}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(`/admin/users/${u.id}`)}>
              <Eye />
              View details
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard?.writeText(u.email);
                toast.success('E-mail copied');
              }}
            >
              <Mail />
              Copy e-mail
            </DropdownMenuItem>
            {canBlock && u.id !== me.id && u.status !== 'DELETED' ? (
              <>
                <DropdownMenuSeparator />
                {u.status === 'BLOCKED' ? (
                  <DropdownMenuItem onSelect={() => setRowAction({ kind: 'unblock', user: u })}>
                    <UserCheck />
                    Unblock
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={() => setRowAction({ kind: 'block', user: u })}>
                    <Ban />
                    Block
                  </DropdownMenuItem>
                )}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const roleOptions = (roles.data ?? []).map((r) => ({ value: r.id, label: r.name }));

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with access to the platform, their roles and resource usage."
        actions={
          can('admin.users.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus />
              Create user
            </Button>
          ) : null
        }
      />
      <DataTable
        aria-label="Users"
        columns={columns}
        data={users.data?.items}
        total={users.data?.total}
        state={table}
        getRowId={(u) => u.id}
        isLoading={users.isPending}
        isFetching={users.isFetching}
        error={users.error}
        onRetry={() => void users.refetch()}
        onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
        selectable={canBlock}
        isRowSelectable={(u) => u.id !== me.id && u.status !== 'DELETED'}
        minWidth={1080}
        bulkActions={({ selected, clear }) => (
          <>
            <Button size="xs" variant="outline" onClick={() => setBulk({ kind: 'block', users: selected, clear })}>
              <Ban />
              Block
            </Button>
            <Button size="xs" variant="outline" onClick={() => setBulk({ kind: 'unblock', users: selected, clear })}>
              <UserCheck />
              Unblock
            </Button>
          </>
        )}
        toolbar={
          <DataTableToolbar
            state={table}
            searchPlaceholder="Search by e-mail or name…"
            filters={
              <>
                <FilterSelect
                  state={table}
                  filterKey="status"
                  allLabel="Active & blocked"
                  aria-label="Status"
                  options={[
                    { value: 'ACTIVE', label: 'Active' },
                    { value: 'BLOCKED', label: 'Blocked' },
                    { value: 'DELETED', label: 'Deleted' },
                  ]}
                />
                <FilterSelect state={table} filterKey="roleId" allLabel="All roles" aria-label="Role" options={roleOptions} />
              </>
            }
          />
        }
        emptyState={
          table.hasActiveFilters ? undefined : (
            <EmptyState
              icon={Users}
              title="No users yet"
              description="Create the first user account for your team."
              action={
                can('admin.users.create') ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <UserPlus />
                    Create user
                  </Button>
                ) : undefined
              }
              compact
            />
          )
        }
      />

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={!!bulk}
        onOpenChange={(open) => {
          if (!open) {
            setBulk(null);
            setBlockReason('');
          }
        }}
        title={bulk?.kind === 'block' ? `Block ${bulk.users.length} user${bulk.users.length === 1 ? '' : 's'}?` : `Unblock ${bulk?.users.length ?? 0} user${bulk?.users.length === 1 ? '' : 's'}?`}
        description={
          bulk?.kind === 'block'
            ? 'Blocked users are signed out everywhere and cannot sign in until they are unblocked.'
            : 'The selected users will be able to sign in again.'
        }
        confirmLabel={bulk?.kind === 'block' ? 'Block users' : 'Unblock users'}
        destructive={bulk?.kind === 'block'}
        onConfirm={() => (bulk ? runBulk(bulk) : undefined)}
      >
        {bulk?.kind === 'block' ? (
          <Textarea
            placeholder="Reason (optional, visible to administrators)"
            value={blockReason}
            maxLength={500}
            onChange={(e) => setBlockReason(e.target.value)}
            className="min-h-16"
          />
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!rowAction}
        onOpenChange={(open) => {
          if (!open) {
            setRowAction(null);
            setBlockReason('');
          }
        }}
        title={rowAction?.kind === 'block' ? `Block ${rowAction.user.email}?` : `Unblock ${rowAction?.user.email ?? ''}?`}
        description={
          rowAction?.kind === 'block'
            ? 'The user is signed out everywhere and cannot sign in until unblocked.'
            : 'The user will be able to sign in again.'
        }
        confirmLabel={rowAction?.kind === 'block' ? 'Block user' : 'Unblock user'}
        destructive={rowAction?.kind === 'block'}
        onConfirm={async () => {
          if (!rowAction) return;
          if (rowAction.kind === 'block') await adminUsersApi.block(rowAction.user.id, blockReason.trim() || undefined);
          else await adminUsersApi.unblock(rowAction.user.id);
          toast.success(rowAction.kind === 'block' ? 'User blocked' : 'User unblocked');
          await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
        }}
      >
        {rowAction?.kind === 'block' ? (
          <Textarea
            placeholder="Reason (optional, visible to administrators)"
            value={blockReason}
            maxLength={500}
            onChange={(e) => setBlockReason(e.target.value)}
            className="min-h-16"
          />
        ) : null}
      </ConfirmDialog>
    </>
  );
}
