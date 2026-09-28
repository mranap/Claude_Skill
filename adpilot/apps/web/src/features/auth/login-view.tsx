'use client';

import { loginSchema, totpCodeSchema, type AuthUserDto } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { ErrorAlert } from '@/components/shared/error-alert';
import { Form, FormField, TextField } from '@/components/shared/form';
import { refreshSession } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useSystemStatus } from '@/lib/api/system-status';
import { safeNextPath } from '@/lib/utils/strings';
import { authApi } from './api';
import { AuthCard } from './auth-card';

const LOGIN_ERROR_TITLES: Partial<Record<string, string>> = {
  UNAUTHORIZED: 'Sign-in failed',
  ACCOUNT_LOCKED: 'Account temporarily locked',
  ACCOUNT_BLOCKED: 'Account blocked',
  RATE_LIMITED: 'Too many attempts',
  MFA_INVALID: 'Verification failed',
  MAINTENANCE: 'Maintenance in progress',
};

function MaintenanceNotice() {
  const status = useSystemStatus();
  if (!status.data?.maintenance.enabled) return null;
  return (
    <Alert variant="warning">
      <AlertTitle>Maintenance in progress</AlertTitle>
      <AlertDescription>{status.data.maintenance.message ?? 'AdPilot is being updated. Please try again later.'}</AlertDescription>
    </Alert>
  );
}

function LoginError({ error }: { error: unknown }) {
  if (!error) return null;
  const title = error instanceof ApiError ? LOGIN_ERROR_TITLES[error.code] : undefined;
  return <ErrorAlert error={error} title={title} showFieldErrors={false} />;
}

export function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeNextPath(searchParams.get('next'));
  const [ticket, setTicket] = useState<string | null>(null);
  const [mfaError, setMfaError] = useState<unknown>(null);

  // Resume an existing session (valid access or refresh cookie) instead of asking for credentials again.
  // GET /auth/session answers without a 401, so an anonymous visit produces no failed requests.
  useEffect(() => {
    const controller = new AbortController();
    const resume = async () => {
      const probe = await authApi.session(controller.signal);
      let user = probe.authenticated ? probe.user : null;
      if (!probe.authenticated && probe.refreshable && (await refreshSession()) === 'ok') user = await authApi.me(controller.signal);
      if (!user || controller.signal.aborted) return;
      queryClient.setQueryData(queryKeys.me, user);
      router.replace(next);
    };
    resume().catch(() => undefined);
    return () => controller.abort();
  }, [next, router, queryClient]);

  const completeSignIn = (user: AuthUserDto) => {
    // Never show a previous user's cached data to the new session.
    queryClient.clear();
    queryClient.setQueryData(queryKeys.me, user);
    router.replace(next);
  };

  if (ticket) {
    return (
      <MfaStep
        ticket={ticket}
        initialError={mfaError}
        onSuccess={completeSignIn}
        onRestart={(error) => {
          setTicket(null);
          setMfaError(error ?? null);
        }}
      />
    );
  }

  return (
    <CredentialsStep
      initialError={mfaError}
      onMfaRequired={(t) => {
        setMfaError(null);
        setTicket(t);
      }}
      onSuccess={completeSignIn}
    />
  );
}

function CredentialsStep({
  onMfaRequired,
  onSuccess,
  initialError,
}: {
  onMfaRequired: (ticket: string) => void;
  onSuccess: (user: AuthUserDto) => void;
  initialError: unknown;
}) {
  const [error, setError] = useState<unknown>(initialError);
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = async (values: z.output<typeof loginSchema>) => {
    setError(null);
    try {
      const res = await authApi.login(values);
      if (res.status === 'MFA_REQUIRED') onMfaRequired(res.ticket);
      else onSuccess(res.user);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.is('UNAUTHORIZED')) form.setValue('password', '');
    }
  };

  return (
    <AuthCard title="Sign in to AdPilot" description="Manage your Meta ad accounts, campaigns and automations.">
      <Form form={form} onSubmit={onSubmit} className="grid gap-4">
        <MaintenanceNotice />
        <LoginError error={error} />
        <TextField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder="you@company.com"
          autoFocus
        />
        <FormField
          control={form.control}
          name="password"
          label="Password"
          labelAction={
            <Link href="/forgot-password" className="text-xs font-medium text-primary-fg hover:underline">
              Forgot password?
            </Link>
          }
          render={({ field, controlProps }) => <PasswordInput {...field} {...controlProps} autoComplete="current-password" />}
        />
        <Button type="submit" className="mt-1 w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </Form>
    </AuthCard>
  );
}

const mfaFormSchema = z.object({ code: totpCodeSchema });

function MfaStep({
  ticket,
  onSuccess,
  onRestart,
  initialError,
}: {
  ticket: string;
  onSuccess: (user: AuthUserDto) => void;
  onRestart: (error?: unknown) => void;
  initialError: unknown;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<unknown>(initialError);
  const form = useForm({ resolver: zodResolver(mfaFormSchema), defaultValues: { code: '' } });

  const onSubmit = async ({ code }: z.output<typeof mfaFormSchema>) => {
    setError(null);
    try {
      const res = await authApi.verifyMfa({ ticket, code });
      onSuccess(res.user);
    } catch (err) {
      // An expired/used ticket means the whole sign-in must start again.
      if (err instanceof ApiError && err.is('MFA_INVALID') && /expired|sign in again/i.test(err.message)) {
        onRestart(err);
        return;
      }
      setError(err);
      form.setValue('code', '');
      form.setFocus('code');
    }
  };

  return (
    <AuthCard
      icon={<ShieldCheck />}
      title="Two-factor authentication"
      description={
        useRecovery
          ? 'Enter one of the recovery codes you saved when you enabled two-factor authentication.'
          : 'Open your authenticator app and enter the 6-digit code for AdPilot.'
      }
      footer={
        <button
          type="button"
          onClick={() => onRestart()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to sign in
        </button>
      }
    >
      <Form form={form} onSubmit={onSubmit} className="grid gap-4">
        <LoginError error={error} />
        <FormField
          control={form.control}
          name="code"
          label={useRecovery ? 'Recovery code' : 'Authentication code'}
          render={({ field, controlProps }) =>
            useRecovery ? (
              <Input
                {...field}
                {...controlProps}
                placeholder="xxxx-xxxx"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="font-mono tracking-wider"
                autoFocus
              />
            ) : (
              <Input
                {...field}
                {...controlProps}
                onChange={(e) => field.onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="h-11 text-center font-mono text-lg tracking-[0.5em]"
                autoFocus
              />
            )
          }
        />
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Verify
        </Button>
        <button
          type="button"
          className="text-center text-sm font-medium text-primary-fg hover:underline"
          onClick={() => {
            setUseRecovery((v) => !v);
            setError(null);
            form.reset({ code: '' });
          }}
        >
          {useRecovery ? 'Use the authenticator app instead' : 'Use a recovery code'}
        </button>
      </Form>
    </AuthCard>
  );
}
