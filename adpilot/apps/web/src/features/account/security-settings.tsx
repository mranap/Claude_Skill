'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable, useLocalTableState } from '@/components/shared/data-table';
import { ErrorAlert } from '@/components/shared/error-alert';
import { getErrorMessage } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { SessionDto } from '@/lib/api/types';
import { accountApi } from './api';
import { ChangePasswordForm } from './change-password-form';
import { loginEventColumns } from './login-events';
import { SessionList } from './session-list';
import { TwoFactorCard } from './two-factor-card';

export function SecuritySettings() {
  const queryClient = useQueryClient();
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Use at least 10 characters with letters and a digit. Changing it signs out your other sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-md">
          <ChangePasswordForm
            onSuccess={async () => {
              toast.success('Password changed', { description: 'Your other sessions were signed out.' });
              await queryClient.invalidateQueries({ queryKey: queryKeys.account.all });
            }}
          />
        </CardContent>
      </Card>
      <TwoFactorCard />
      <SessionsCard />
      <LoginHistoryCard />
    </div>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: queryKeys.account.sessions, queryFn: accountApi.sessions });
  const [target, setTarget] = useState<SessionDto | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);

  const revoke = useMutation({
    mutationFn: (id: string) => accountApi.revokeSession(id),
    onSuccess: () => toast.success('Session signed out'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.account.sessions }),
  });

  const others = (sessions.data ?? []).filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Devices currently signed in to your account. Sign out any session you don’t recognise.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={!others} onClick={() => setConfirmOthers(true)}>
            <LogOut />
            <span className="hidden sm:inline">Sign out other sessions</span>
            <span className="sm:hidden">Others</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : sessions.error ? (
          <ErrorAlert error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <SessionList
            sessions={sessions.data}
            onRevoke={setTarget}
            revokingId={revoke.isPending ? revoke.variables : null}
          />
        )}
      </CardContent>

      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Sign out this session?"
        description="The device will be signed out immediately and will need to sign in again."
        confirmLabel="Sign out session"
        destructive
        onConfirm={() => revoke.mutateAsync(target!.id)}
      />
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out all other sessions?"
        description={`${others} other session${others === 1 ? '' : 's'} will be signed out. This device stays signed in.`}
        confirmLabel="Sign out others"
        destructive
        onConfirm={async () => {
          try {
            const res = await accountApi.revokeOtherSessions();
            toast.success(`${res.revoked} session${res.revoked === 1 ? '' : 's'} signed out`);
          } catch (err) {
            toast.error('Could not sign out other sessions', { description: getErrorMessage(err) });
            throw err;
          } finally {
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.sessions });
          }
        }}
      />
    </Card>
  );
}

function LoginHistoryCard() {
  const table = useLocalTableState({ defaultPageSize: 10 });
  const history = useQuery({
    queryKey: queryKeys.account.loginHistory(table.params),
    queryFn: () => accountApi.loginHistory(table.params),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Login history</CardTitle>
        <CardDescription>Recent sign-in attempts for your account, including failed ones.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          aria-label="Login history"
          columns={loginEventColumns}
          data={history.data?.items}
          total={history.data?.total}
          state={table}
          getRowId={(e) => e.id}
          isLoading={history.isPending}
          isFetching={history.isFetching}
          error={history.error}
          onRetry={() => void history.refetch()}
          stickyHeader={false}
          minWidth={640}
        />
      </CardContent>
    </Card>
  );
}
