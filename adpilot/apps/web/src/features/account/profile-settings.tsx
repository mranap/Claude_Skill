'use client';

import { changeEmailSchema, updateProfileSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { MailCheck, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { UserAvatar } from '@/components/ui/avatar';
import { Form, FormField, FormRootError, TextField } from '@/components/shared/form';
import { KeyValueList } from '@/components/shared/key-value';
import { TimeZoneSelect } from '@/components/shared/time-zone-select';
import { useAuth } from '@/features/auth/auth-context';
import { queryKeys } from '@/lib/api/query-keys';
import { browserTimeZone, timeZoneOffset } from '@/lib/utils/timezones';
import { humanize } from '@/lib/utils/strings';
import { accountApi } from './api';

export function ProfileSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [emailOpen, setEmailOpen] = useState(false);

  const form = useForm({
    resolver: zodResolver(updateProfileSchema),
    values: { name: user.name ?? '', timezone: user.timezone },
    resetOptions: { keepDirtyValues: true },
  });

  const onSubmit = async (values: z.output<typeof updateProfileSchema>) => {
    const updated = await accountApi.updateProfile({ name: values.name ? values.name : null, timezone: values.timezone });
    queryClient.setQueryData(queryKeys.me, updated);
    form.reset({ name: updated.name ?? '', timezone: updated.timezone });
    toast.success('Profile saved');
  };

  const detectedZone = browserTimeZone();
  const selectedZone = useWatch({ control: form.control, name: 'timezone' });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your name is shown to administrators; the time zone is used for dates, schedules and reports.</CardDescription>
        </CardHeader>
        <Form form={form} onSubmit={onSubmit}>
          <CardContent className="grid gap-5">
            <FormRootError />
            <div className="flex items-center gap-4">
              <UserAvatar name={user.name} email={user.email} seed={user.id} size="xl" />
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name || 'No name set'}</p>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <TextField control={form.control} name="name" label="Full name" placeholder="Jane Doe" autoComplete="name" maxLength={100} />
              <FormField
                control={form.control}
                name="timezone"
                label="Time zone"
                description={
                  detectedZone !== selectedZone ? (
                    <>
                      Your browser uses {detectedZone.replace(/_/g, ' ')} ({timeZoneOffset(detectedZone).replace('GMT', 'UTC')}).{' '}
                      <button
                        type="button"
                        className="font-medium text-primary-fg hover:underline"
                        onClick={() => form.setValue('timezone', detectedZone, { shouldDirty: true })}
                      >
                        Use it
                      </button>
                    </>
                  ) : undefined
                }
                render={({ field, controlProps }) => (
                  <TimeZoneSelect
                    id={controlProps.id}
                    aria-invalid={controlProps['aria-invalid']}
                    value={field.value}
                    onValueChange={(v) => field.onChange(v)}
                  />
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-email">Email</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="profile-email" value={user.email} readOnly className="sm:max-w-sm" />
                <Button type="button" variant="outline" onClick={() => setEmailOpen(true)}>
                  <Pencil />
                  Change e-mail
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">You sign in with this address. Changes must be confirmed from the new inbox.</p>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button type="button" variant="ghost" disabled={!form.formState.isDirty} onClick={() => form.reset()}>
              Discard
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
              Save changes
            </Button>
          </CardFooter>
        </Form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Details managed by your administrators.</CardDescription>
        </CardHeader>
        <CardContent>
          <KeyValueList
            items={[
              { label: 'Role', value: <Badge variant={user.isAdmin ? 'default' : 'secondary'}>{humanize(user.role)}</Badge> },
              {
                label: 'Two-factor authentication',
                value: user.twoFactorEnabled ? <Badge variant="success">Enabled</Badge> : <Badge variant="warning">Not enabled</Badge>,
              },
              { label: 'Permissions', value: `${user.permissions.length} granted` },
              { label: 'User ID', value: user.id, mono: true, copy: user.id },
            ]}
          />
        </CardContent>
      </Card>

      <ChangeEmailDialog open={emailOpen} onOpenChange={setEmailOpen} currentEmail={user.email} />
    </div>
  );
}

function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEmail: string;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(changeEmailSchema), defaultValues: { newEmail: '', password: '' } });

  const onSubmit = async (values: z.output<typeof changeEmailSchema>) => {
    await accountApi.changeEmail(values);
    setSentTo(values.newEmail);
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      form.reset();
      setSentTo(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="sm">
        {sentTo ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MailCheck className="size-5 text-success-fg" />
                Confirm your new e-mail
              </DialogTitle>
              <DialogDescription>
                We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>. Your login e-mail
                changes after you open that link (valid for 24 hours). Until then, keep signing in with {currentEmail}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <Form form={form} onSubmit={onSubmit} className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>Change e-mail address</DialogTitle>
              <DialogDescription>Enter the new address and your current password. We’ll send a confirmation link.</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <FormRootError />
              <TextField control={form.control} name="newEmail" label="New e-mail" type="email" autoComplete="email" autoFocus />
              <FormField
                control={form.control}
                name="password"
                label="Current password"
                render={({ field, controlProps }) => <PasswordInput {...field} {...controlProps} autoComplete="current-password" />}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting}>
                Send confirmation link
              </Button>
            </DialogFooter>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
