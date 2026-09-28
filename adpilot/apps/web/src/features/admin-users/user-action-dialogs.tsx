'use client';

import { adminResetPasswordSchema, adminUpdateUserSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Link2, Wand2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PasswordInput, generatePassword } from '@/components/ui/password-input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Form, FormField, FormRootError, TextField } from '@/components/shared/form';
import { TimeZoneSelect } from '@/components/shared/time-zone-select';
import type { AdminUserDetail, RoleDto } from '@/lib/api/types';
import { adminUsersApi } from './api';
import { RoleSelect } from './role-select';

const MB = BigInt(1024 * 1024);

function quotaToMb(bytes: string | null): number | null {
  if (bytes === null) return null;
  try {
    return Number(BigInt(bytes) / MB);
  } catch {
    return null;
  }
}

/** Edit name, role, time zone and storage quota (`PATCH /admin/users/:id`). */
export function EditUserDialog({
  user,
  roles,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUserDetail;
  roles: RoleDto[] | undefined;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (user: AdminUserDetail) => void;
}) {
  const form = useForm({
    resolver: zodResolver(adminUpdateUserSchema),
    defaultValues: {
      name: user.name ?? '',
      roleId: user.role.id,
      timezone: user.timezone,
      storageQuotaMb: quotaToMb(user.storageQuotaBytes),
    },
  });
  const quota = useWatch({ control: form.control, name: 'storageQuotaMb' });

  const onSubmit = async (values: z.output<typeof adminUpdateUserSchema>) => {
    const dirty = form.formState.dirtyFields;
    const body: z.output<typeof adminUpdateUserSchema> = {};
    if (dirty.name) body.name = values.name?.trim() ? values.name.trim() : null;
    if (dirty.roleId && !isSelf) body.roleId = values.roleId;
    if (dirty.timezone) body.timezone = values.timezone;
    if (dirty.storageQuotaMb) body.storageQuotaMb = values.storageQuotaMb ?? null;
    const updated = await adminUsersApi.update(user.id, body);
    toast.success('User updated');
    onSaved(updated);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <Form form={form} onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <FormRootError />
            <TextField control={form.control} name="name" label="Full name" autoComplete="off" />
            <FormField
              control={form.control}
              name="roleId"
              label="Role"
              description={isSelf ? 'You cannot change your own role.' : 'Changing the role takes effect on the user’s next request.'}
              render={({ field, controlProps }) => (
                <RoleSelect
                  id={controlProps.id}
                  roles={roles}
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isSelf}
                />
              )}
            />
            <FormField
              control={form.control}
              name="timezone"
              label="Time zone"
              render={({ field, controlProps }) => <TimeZoneSelect id={controlProps.id} value={field.value} onValueChange={field.onChange} />}
            />
            <FormField
              control={form.control}
              name="storageQuotaMb"
              label="Storage quota"
              description={quota === null || quota === undefined ? 'Uses the platform default (System settings → Files).' : 'Custom limit for this user, in megabytes.'}
              render={({ field, controlProps }) => (
                <div className="flex items-center gap-3">
                  <label className="flex shrink-0 items-center gap-2 text-sm">
                    <Switch
                      checked={field.value !== null && field.value !== undefined}
                      onCheckedChange={(on) => field.onChange(on ? (quotaToMb(user.storageQuotaBytes) ?? 20480) : null)}
                    />
                    Custom
                  </label>
                  {field.value !== null && field.value !== undefined ? (
                    <div className="relative w-40">
                      <Input
                        {...controlProps}
                        type="number"
                        min={0}
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)}
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">MB</span>
                    </div>
                  ) : null}
                </div>
              )}
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
              Save changes
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Admin password reset: e-mail a one-time link or set a temporary password. */
export function ResetPasswordDialog({ user, onClose, onDone }: { user: AdminUserDetail; onClose: () => void; onDone: () => void }) {
  const form = useForm({
    resolver: zodResolver(adminResetPasswordSchema),
    defaultValues: { mode: 'link' as const, password: undefined },
  });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const password = useWatch({ control: form.control, name: 'password' });

  const onSubmit = async (values: z.output<typeof adminResetPasswordSchema>) => {
    await adminUsersApi.resetPassword(user.id, { mode: values.mode, password: values.mode === 'password' ? values.password : undefined });
    toast.success(values.mode === 'link' ? 'Reset link sent' : 'Temporary password set', {
      description:
        values.mode === 'link'
          ? `${user.email} received a link to choose a new password.`
          : 'The user must change it at the next sign-in. All sessions were signed out.',
    });
    onDone();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <Form form={form} onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {user.email} will be signed out of every session. Their current password stops working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <FormRootError />
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-3 sm:grid-cols-2">
                  <RadioCard value="link" icon={<Link2 />} title="Send a reset link" description="One-time link by e-mail, valid for 1 hour." />
                  <RadioCard
                    value="password"
                    icon={<KeyRound />}
                    title="Set a temporary password"
                    description="The user must change it at the next sign-in."
                  />
                </RadioGroup>
              )}
            />
            {mode === 'password' ? (
              <FormField
                control={form.control}
                name="password"
                label="Temporary password"
                labelAction={
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => form.setValue('password', generatePassword(), { shouldValidate: true })}
                    >
                      <Wand2 />
                      Generate
                    </Button>
                    {password ? <CopyButton value={password} /> : null}
                  </div>
                }
                render={({ field, controlProps }) => (
                  <PasswordInput {...controlProps} {...field} value={field.value ?? ''} autoComplete="new-password" showStrength />
                )}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {mode === 'link' ? 'Send reset link' : 'Set password'}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

