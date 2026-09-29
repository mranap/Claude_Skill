'use client';

import { adminCreateUserSchema, SYSTEM_ROLES } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, MailPlus, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import { PasswordInput, generatePassword } from '@/components/ui/password-input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { Form, FormField, FormRootError, TextField } from '@/components/shared/form';
import { TimeZoneSelect } from '@/components/shared/time-zone-select';
import { queryKeys } from '@/lib/api/query-keys';
import { adminUsersApi } from './api';
import { useRoles } from './hooks';
import { RoleSelect } from './role-select';

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const roles = useRoles(open);
  const defaultRoleId = roles.data?.find((r) => r.key === SYSTEM_ROLES.USER)?.id ?? '';

  const form = useForm({
    resolver: zodResolver(adminCreateUserSchema),
    defaultValues: {
      email: '',
      name: '',
      roleId: '',
      mode: 'invite' as const,
      password: undefined,
      timezone: 'UTC',
    },
  });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const password = useWatch({ control: form.control, name: 'password' });

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) form.reset();
  };

  const onSubmit = async (values: z.output<typeof adminCreateUserSchema>) => {
    const user = await adminUsersApi.create({
      ...values,
      name: values.name?.trim() || undefined,
      password: values.mode === 'password' ? values.password : undefined,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles });
    toast.success('User created', {
      description:
        values.mode === 'invite'
          ? `An invitation e-mail was sent to ${user.email}.`
          : `${user.email} must change the temporary password at the first sign-in.`,
      action: { label: 'View', onClick: () => router.push(`/admin/users/${user.id}`) },
    });
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <Form form={form} onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              New users can sign in right away with an invitation link or a temporary password.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <FormRootError />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="email"
                label="Email"
                type="email"
                required
                autoComplete="off"
                autoFocus
              />
              <TextField
                control={form.control}
                name="name"
                label="Full name"
                autoComplete="off"
                placeholder="Optional"
              />
              <FormField
                control={form.control}
                name="roleId"
                label="Role"
                required
                render={({ field, controlProps }) => (
                  <RoleSelect
                    id={controlProps.id}
                    aria-invalid={controlProps['aria-invalid']}
                    roles={roles.data}
                    value={field.value || defaultRoleId || undefined}
                    onValueChange={field.onChange}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="timezone"
                label="Time zone"
                render={({ field, controlProps }) => (
                  <TimeZoneSelect id={controlProps.id} value={field.value} onValueChange={field.onChange} />
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="mode"
              label="How will the user get access?"
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <RadioCard
                    value="invite"
                    icon={<MailPlus />}
                    title="Send an invitation"
                    description="The user receives a one-time link (valid 72 hours) to set a password."
                  />
                  <RadioCard
                    value="password"
                    icon={<KeyRound />}
                    title="Set a temporary password"
                    description="Share it securely; the user must change it at the first sign-in."
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
                      onClick={() =>
                        form.setValue('password', generatePassword(), {
                          shouldValidate: true,
                          shouldDirty: true,
                        })
                      }
                    >
                      <Wand2 />
                      Generate
                    </Button>
                    {password ? <CopyButton value={password} /> : null}
                  </div>
                }
                render={({ field, controlProps }) => (
                  <PasswordInput
                    {...controlProps}
                    {...field}
                    value={field.value ?? ''}
                    autoComplete="new-password"
                    showStrength
                  />
                )}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={form.formState.isSubmitting}
              onClick={() => {
                if (!form.getValues('roleId') && defaultRoleId) form.setValue('roleId', defaultRoleId);
              }}
            >
              {mode === 'invite' ? 'Create and send invite' : 'Create user'}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
