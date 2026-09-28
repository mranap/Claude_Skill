'use client';

import { hasPermission, SYSTEM_ROLES } from '@adpilot/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { LogoMark } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ErrorAlert } from '@/components/shared/error-alert';
import { onApiEvent } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { setDisplayTimeZone } from '@/lib/utils/format';
import { authApi } from './api';
import { AuthContext, type AuthContextValue } from './auth-context';
import { ForcedPasswordChange } from './forced-password-change';

export function FullPageStatus({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4">
      <LogoMark className="size-10 rounded-xl" />
      {children ?? <Spinner className="size-5" />}
    </div>
  );
}

/** Performs sign-out: revokes the session server-side, clears cached data and goes to /login. */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The session may already be gone; local state is cleared either way.
    }
    queryClient.clear();
    router.replace('/login');
  }, [queryClient, router]);
}

/**
 * Loads the signed-in user (`GET /api/auth/me`, with the client's refresh-on-401 logic), gates the
 * authenticated area and exposes permissions. Unauthenticated users are sent to /login?next=<path>;
 * users with `mustChangePassword` see the blocking "Set a new password" screen.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  const redirecting = useRef(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);

  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => authApi.me(signal),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const goToLogin = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    const next = `${window.location.pathname}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [router]);

  useEffect(
    () =>
      onApiEvent((event) => {
        if (event.type === 'unauthenticated') goToLogin();
        else if (event.type === 'password-change-required') void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        else if (event.type === 'maintenance') setMaintenanceMessage(event.message);
      }),
    [goToLogin, queryClient],
  );

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) goToLogin();
  }, [unauthenticated, goToLogin]);

  const user = me.data;
  // Absolute dates follow the profile's time zone (idempotent; must run before children render).
  if (user) setDisplayTimeZone(user.timezone);

  const value = useMemo<AuthContextValue | null>(() => {
    if (!user) return null;
    return {
      user,
      isSuperAdmin: user.role === SYSTEM_ROLES.SUPER_ADMIN,
      can: (permission) => hasPermission(user.role, user.permissions, permission),
      canAny: (permissions) => permissions.some((p) => hasPermission(user.role, user.permissions, p)),
      signOut,
      maintenanceMessage,
    };
  }, [user, signOut, maintenanceMessage]);

  if (!value) {
    if (me.error && !unauthenticated) {
      return (
        <FullPageStatus>
          <div className="w-full max-w-md space-y-3">
            <ErrorAlert error={me.error} title="We couldn’t load your account" />
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void me.refetch()} loading={me.isFetching}>
                <RotateCcw />
                Try again
              </Button>
            </div>
          </div>
        </FullPageStatus>
      );
    }
    return <FullPageStatus />;
  }

  return (
    <AuthContext.Provider value={value}>
      {value.user.mustChangePassword ? <ForcedPasswordChange /> : children}
    </AuthContext.Provider>
  );
}
