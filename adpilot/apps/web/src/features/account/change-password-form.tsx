'use client';

import { changePasswordSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Form, FormField, FormRootError } from '@/components/shared/form';
import { accountApi } from './api';

const schema = changePasswordSchema
  .extend({ confirmPassword: z.string().min(1, 'Repeat the new password') })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export function ChangePasswordForm({
  onSuccess,
  submitLabel = 'Update password',
  currentPasswordLabel = 'Current password',
  fullWidthSubmit = false,
}: {
  onSuccess?: () => void | Promise<void>;
  submitLabel?: string;
  currentPasswordLabel?: string;
  fullWidthSubmit?: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: z.output<typeof schema>) => {
    await accountApi.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    form.reset();
    await onSuccess?.();
  };

  return (
    <Form form={form} onSubmit={onSubmit} className="grid gap-4">
      <FormRootError />
      <FormField
        control={form.control}
        name="currentPassword"
        label={currentPasswordLabel}
        render={({ field, controlProps }) => (
          <PasswordInput {...field} {...controlProps} autoComplete="current-password" />
        )}
      />
      <FormField
        control={form.control}
        name="newPassword"
        label="New password"
        render={({ field, controlProps }) => (
          <PasswordInput {...field} {...controlProps} autoComplete="new-password" showStrength />
        )}
      />
      <FormField
        control={form.control}
        name="confirmPassword"
        label="Confirm new password"
        render={({ field, controlProps }) => (
          <PasswordInput {...field} {...controlProps} autoComplete="new-password" />
        )}
      />
      <div>
        <Button
          type="submit"
          loading={form.formState.isSubmitting}
          className={fullWidthSubmit ? 'w-full' : undefined}
        >
          {submitLabel}
        </Button>
      </div>
    </Form>
  );
}
