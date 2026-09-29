'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, LinkIcon, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ErrorAlert } from '@/components/shared/error-alert';
import { isApiError } from '@/lib/api/errors';
import { authApi } from './api';
import { AuthCard } from './auth-card';
import { useUrlToken } from './url-token';

export function ConfirmEmailView() {
  const urlToken = useUrlToken();
  const token = urlToken ?? '';

  // A query (not an effect) so the one-time token is posted exactly once, even in React Strict Mode.
  const confirmation = useQuery({
    queryKey: ['auth', 'confirm-email', token],
    queryFn: () => authApi.confirmEmail(token),
    enabled: token.length >= 20,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (urlToken === undefined) {
    return (
      <AuthCard icon={<MailCheck />} title="Confirming your new e-mail…">
        <div className="flex justify-center py-2">
          <Spinner className="size-5" />
        </div>
      </AuthCard>
    );
  }

  if (token.length < 20 || isApiError(confirmation.error, 'BAD_REQUEST', 'VALIDATION_ERROR', 'NOT_FOUND')) {
    return (
      <AuthCard
        icon={<LinkIcon />}
        title="This confirmation link is invalid or has expired"
        description="E-mail change links can be used once and expire after 24 hours. Start the change again from Settings → Profile."
      >
        <Button asChild className="w-full">
          <Link href="/settings/profile">Go to settings</Link>
        </Button>
      </AuthCard>
    );
  }

  if (confirmation.isPending) {
    return (
      <AuthCard icon={<MailCheck />} title="Confirming your new e-mail…">
        <div className="flex justify-center py-2">
          <Spinner className="size-5" />
        </div>
      </AuthCard>
    );
  }

  if (confirmation.error) {
    return (
      <AuthCard title="We couldn’t confirm your e-mail">
        <ErrorAlert error={confirmation.error} onRetry={() => void confirmation.refetch()} />
      </AuthCard>
    );
  }

  // The API signs out every session of the account when the sign-in address changes.
  return (
    <AuthCard
      icon={<CircleCheck />}
      title="E-mail changed — sign in with your new address"
      description="For your security all sessions were signed out, including this one. We also notified your previous address about the change."
    >
      <Button asChild className="w-full">
        <Link href="/login">Sign in</Link>
      </Button>
    </AuthCard>
  );
}
