'use client';

import { disable2faSchema, enable2faSchema, totpCodeSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Stepper } from '@/components/ui/stepper';
import { ErrorAlert } from '@/components/shared/error-alert';
import { Form, FormField, FormRootError } from '@/components/shared/form';
import { useAuth } from '@/features/auth/auth-context';
import { queryKeys } from '@/lib/api/query-keys';
import type { TwoFactorSetupResponse } from '@/lib/api/types';
import { accountApi } from './api';
import { RecoveryCodes } from './recovery-codes';

function CodeInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="123456"
      className="max-w-44 font-mono text-base tracking-[0.35em]"
    />
  );
}

export function TwoFactorCard() {
  const { user } = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const setup = useMutation({ mutationFn: accountApi.setup2fa });

  // The setup call happens in the click handler so exactly one pending secret is created per attempt.
  const openSetup = () => {
    setup.reset();
    setup.mutate();
    setSetupOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication
          {user.twoFactorEnabled ? (
            <Badge variant="success">Enabled</Badge>
          ) : (
            <Badge variant="warning">Off</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Require a code from an authenticator app (Google Authenticator, 1Password, Authy…) every time you
          sign in.
        </CardDescription>
        <CardAction className="hidden sm:flex">
          {user.twoFactorEnabled ? null : (
            <Button onClick={openSetup}>
              <ShieldCheck />
              Enable 2FA
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        {user.twoFactorEnabled ? (
          <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success-fg">
                <Smartphone className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">Authenticator app</p>
                <p className="text-[13px] text-muted-foreground">
                  Codes are required at sign-in. Keep your recovery codes somewhere safe.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
                <KeyRound />
                New recovery codes
              </Button>
              <Button variant="destructive-outline" size="sm" onClick={() => setDisableOpen(true)}>
                <ShieldOff />
                Disable
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted-foreground">
              Your account is protected by a password only. Administrators may require 2FA to use admin
              features.
            </p>
            <Button className="sm:hidden" onClick={openSetup}>
              <ShieldCheck />
              Enable 2FA
            </Button>
          </div>
        )}
      </CardContent>
      {setupOpen ? <SetupDialog setup={setup} onClose={() => setSetupOpen(false)} /> : null}
      {disableOpen ? <DisableDialog onClose={() => setDisableOpen(false)} /> : null}
      {regenOpen ? <RegenerateDialog onClose={() => setRegenOpen(false)} /> : null}
    </Card>
  );
}

const SETUP_STEPS = [
  { id: 'scan', title: 'Scan' },
  { id: 'verify', title: 'Verify' },
  { id: 'save', title: 'Save codes' },
];

function SetupDialog({
  setup,
  onClose,
}: {
  setup: UseMutationResult<TwoFactorSetupResponse, Error, void>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm({ resolver: zodResolver(enable2faSchema), defaultValues: { code: '' } });

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    onClose();
  };

  const onVerify = async ({ code }: z.output<typeof enable2faSchema>) => {
    const res = await accountApi.enable2fa(code);
    setCodes(res.recoveryCodes);
    setStep(2);
    toast.success('Two-factor authentication enabled');
  };

  const data: TwoFactorSetupResponse | undefined = setup.data;
  const secretGroups = data?.secret.replace(/(.{4})/g, '$1 ').trim();

  return (
    <Dialog open onOpenChange={(open) => !open && (codes ? void finish() : onClose())}>
      <DialogContent size="md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Enable two-factor authentication</DialogTitle>
          <DialogDescription>
            Three quick steps. You’ll need your phone with an authenticator app.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-5">
          <Stepper steps={SETUP_STEPS} current={step} className="mx-auto max-w-sm" />
          {step === 0 ? (
            setup.error ? (
              <ErrorAlert error={setup.error} onRetry={() => setup.mutate()} />
            ) : !data ? (
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="size-[196px] rounded-lg" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL generated by the API */}
                <img
                  src={data.qrDataUrl}
                  alt="QR code for your authenticator app"
                  width={196}
                  height={196}
                  className="mx-auto rounded-lg border bg-white p-2"
                />
                <div className="grid gap-3 text-sm">
                  <p className="text-muted-foreground">
                    Scan the QR code with your authenticator app. If you can’t scan it, enter this setup key
                    manually:
                  </p>
                  <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-3 py-2">
                    <code className="flex-1 font-mono text-[13px] break-all">{secretGroups}</code>
                    <CopyButton value={data.secret} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Account: {user.email} · Type: time-based (TOTP), 6 digits.
                  </p>
                </div>
              </div>
            )
          ) : null}
          {step === 1 ? (
            <Form form={form} onSubmit={onVerify} id="enable-2fa-form" className="grid gap-4">
              <FormRootError />
              <FormField
                control={form.control}
                name="code"
                label="6-digit code from your app"
                description="Codes change every 30 seconds. If it keeps failing, check that the time on your phone is set automatically."
                render={({ field, controlProps }) => (
                  <CodeInput
                    {...controlProps}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    autoFocus
                  />
                )}
              />
            </Form>
          ) : null}
          {step === 2 && codes ? (
            <div className="grid gap-4">
              <RecoveryCodes codes={codes} email={user.email} />
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />I have saved my
                recovery codes in a safe place
              </label>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {step === 0 ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep(1)} disabled={!data}>
                Continue
              </Button>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button type="submit" form="enable-2fa-form" loading={form.formState.isSubmitting}>
                Verify and enable
              </Button>
            </>
          ) : null}
          {step === 2 ? (
            <Button onClick={() => void finish()} disabled={!saved}>
              Done
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [useRecovery, setUseRecovery] = useState(false);
  const form = useForm({
    resolver: zodResolver(disable2faSchema),
    defaultValues: { password: '', code: '' },
  });

  const onSubmit = async (values: z.output<typeof disable2faSchema>) => {
    await accountApi.disable2fa(values);
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    toast.success('Two-factor authentication disabled');
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <Form form={form} onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication?</DialogTitle>
            <DialogDescription>
              Your account will be protected by the password only. Confirm with your password and a code.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <FormRootError />
            <FormField
              control={form.control}
              name="password"
              label="Password"
              render={({ field, controlProps }) => (
                <PasswordInput {...field} {...controlProps} autoComplete="current-password" autoFocus />
              )}
            />
            <FormField
              control={form.control}
              name="code"
              label={useRecovery ? 'Recovery code' : 'Authentication code'}
              labelAction={
                <button
                  type="button"
                  className="text-xs font-medium text-primary-fg hover:underline"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    form.setValue('code', '');
                  }}
                >
                  {useRecovery ? 'Use app code' : 'Use a recovery code'}
                </button>
              }
              render={({ field, controlProps }) =>
                useRecovery ? (
                  <Input
                    {...field}
                    {...controlProps}
                    placeholder="xxxx-xxxx"
                    className="max-w-44 font-mono"
                    autoComplete="off"
                  />
                ) : (
                  <CodeInput
                    {...controlProps}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )
              }
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={form.formState.isSubmitting}>
              Disable 2FA
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const regenerateSchema = z.object({
  code: totpCodeSchema.refine((v) => /^\d{6}$/.test(v), 'Enter the 6-digit code from your app'),
});

function RegenerateDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [codes, setCodes] = useState<string[] | null>(null);
  const form = useForm({ resolver: zodResolver(regenerateSchema), defaultValues: { code: '' } });

  const onSubmit = async ({ code }: z.output<typeof regenerateSchema>) => {
    const res = await accountApi.regenerateRecoveryCodes(code);
    setCodes(res.recoveryCodes);
    toast.success('New recovery codes generated', { description: 'Your previous codes no longer work.' });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        {codes ? (
          <>
            <DialogHeader>
              <DialogTitle>Your new recovery codes</DialogTitle>
              <DialogDescription>The previous recovery codes were invalidated.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <RecoveryCodes codes={codes} email={user.email} />
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <Form form={form} onSubmit={onSubmit} className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>Generate new recovery codes</DialogTitle>
              <DialogDescription>
                This replaces all existing recovery codes. Enter a code from your authenticator app to
                continue.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <FormRootError />
              <FormField
                control={form.control}
                name="code"
                label="Authentication code"
                render={({ field, controlProps }) => (
                  <CodeInput
                    {...controlProps}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    autoFocus
                  />
                )}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting}>
                Generate codes
              </Button>
            </DialogFooter>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
