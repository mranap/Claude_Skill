'use client';

import { forgotPasswordSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/shared/error-alert';
import { Form, TextField } from '@/components/shared/form';
import { isApiError } from '@/lib/api/errors';
import { authApi } from './api';
import { AuthCard } from './auth-card';

const NEUTRAL_MESSAGE = 'If an account exists for this e-mail, a reset link has been sent.';

export function ForgotPasswordView() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const form = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = async ({ email }: z.output<typeof forgotPasswordSchema>) => {
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (err) {
      // Never reveal whether the address exists: only throttling and connectivity problems are shown.
      if (isApiError(err, 'RATE_LIMITED', 'NETWORK_ERROR', 'MAINTENANCE')) setError(err);
      else setSentTo(email);
    }
  };

  const backLink = (
    <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" />
      Back to sign in
    </Link>
  );

  if (sentTo) {
    return (
      <AuthCard
        icon={<MailCheck />}
        title="Check your inbox"
        description={
          <>
            {NEUTRAL_MESSAGE} The link for <span className="font-medium text-foreground">{sentTo}</span> expires soon, so use
            it right away. Don’t forget to check the spam folder.
          </>
        }
        footer={backLink}
      >
        <Button variant="outline" className="w-full" onClick={() => setSentTo(null)}>
          Use a different e-mail
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the e-mail address of your account and we’ll send you a link to choose a new password."
      footer={backLink}
    >
      <Form form={form} onSubmit={onSubmit} className="grid gap-4">
        {error ? <ErrorAlert error={error} /> : null}
        <TextField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          autoFocus
        />
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </Form>
    </AuthCard>
  );
}
