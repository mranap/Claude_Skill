'use client';

import { passwordSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, KeyRound, LinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/shared/error-alert';
import { Form, FormField, FormRootError } from '@/components/shared/form';
import { authApi } from './api';
import { AuthCard } from './auth-card';
import { forgetUrlToken, useUrlToken } from './url-token';

const schema = z
  .object({ password: passwordSchema, confirmPassword: z.string().min(1, 'Repeat the password') })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export function ResetPasswordView() {
  const searchParams = useSearchParams();
  const urlToken = useUrlToken();
  const token = urlToken ?? '';
  const inviteParam = searchParams.get('invite') === '1';
  const [done, setDone] = useState(false);

  const validation = useQuery({
    queryKey: ['auth', 'reset-token', token],
    queryFn: () => authApi.validateResetToken(token),
    enabled: token.length >= 20,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const isInvite = inviteParam || validation.data?.purpose === 'INVITE';
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: z.output<typeof schema>) => {
    await authApi.resetPassword({ token, password: values.password });
    forgetUrlToken();
    setDone(true);
  };

  if (done) {
    return (
      <AuthCard
        icon={<CircleCheck />}
        title={isInvite ? 'Your password is set' : 'Password updated'}
        description={
          isInvite
            ? 'Your account is ready. Sign in with your e-mail and the password you just chose.'
            : 'Your password was changed and all other sessions were signed out. Sign in with the new password.'
        }
      >
        <Button asChild className="w-full">
          <Link href="/login">Continue to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  if (urlToken === undefined) {
    // Server render / hydration: the token is read from the URL fragment in the browser only.
    return (
      <AuthCard
        title={isInvite ? 'Set your password' : 'Choose a new password'}
        description="Checking your link…"
      >
        <div className="grid gap-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </AuthCard>
    );
  }

  if (token.length < 20 || validation.data?.valid === false) {
    return (
      <AuthCard
        icon={<LinkIcon />}
        title="This link is invalid or has expired"
        description={
          isInvite
            ? 'Invitation links can be used once and expire after a few days. Ask your administrator to send a new invitation.'
            : 'Reset links can be used once and expire quickly for your security. Request a new one to continue.'
        }
        footer={
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Back to sign in
          </Link>
        }
      >
        {!isInvite ? (
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        ) : null}
      </AuthCard>
    );
  }

  if (validation.isPending) {
    return (
      <AuthCard
        title={isInvite ? 'Set your password' : 'Choose a new password'}
        description="Checking your link…"
      >
        <div className="grid gap-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </AuthCard>
    );
  }

  if (validation.error) {
    return (
      <AuthCard title="We couldn’t check this link">
        <ErrorAlert error={validation.error} onRetry={() => void validation.refetch()} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={<KeyRound />}
      title={isInvite ? 'Set your password' : 'Choose a new password'}
      description={
        isInvite
          ? 'Welcome to AdPilot! Choose a password to activate your account.'
          : 'Choose a strong password you don’t use anywhere else.'
      }
    >
      <Form form={form} onSubmit={onSubmit} className="grid gap-4">
        <FormRootError />
        <FormField
          control={form.control}
          name="password"
          label={isInvite ? 'Password' : 'New password'}
          render={({ field, controlProps }) => (
            <PasswordInput {...field} {...controlProps} autoComplete="new-password" showStrength autoFocus />
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          label="Confirm password"
          render={({ field, controlProps }) => (
            <PasswordInput {...field} {...controlProps} autoComplete="new-password" />
          )}
        />
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {isInvite ? 'Set password' : 'Update password'}
        </Button>
      </Form>
    </AuthCard>
  );
}
