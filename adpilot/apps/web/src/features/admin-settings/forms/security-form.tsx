'use client';

import { securitySettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { NumberField } from '@/components/shared/form';
import { useAuth } from '@/features/auth/auth-context';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { SwitchField } from '../fields';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

const schema = securitySettingsSchema.refine((v) => v.sessionIdleDays <= v.sessionLifetimeDays, {
  path: ['sessionIdleDays'],
  message: 'Cannot be longer than the session lifetime',
});

export function SecuritySettingsForm({
  values,
  readOnly,
}: {
  values: AdminSettingGroup<'security'>;
  readOnly: boolean;
}) {
  const { user } = useAuth();
  const save = useSaveSettings('security');
  const form = useForm({
    resolver: zodResolver(schema),
    values: pickSchemaValues(securitySettingsSchema.shape, values),
  });
  const require2fa = useWatch({ control: form.control, name: 'require2faForAdmins' });

  return (
    <SettingsFormCard
      title="Security"
      description="Session lifetime, brute-force protection and the two-factor policy for administrators."
      form={form}
      readOnly={readOnly}
      permission={managePermission('security')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
    >
      <FieldSection
        title="Sessions"
        description="Refresh tokens rotate on every use; access tokens live 15 minutes."
      >
        <FieldGrid>
          <NumberField
            control={form.control}
            name="sessionLifetimeDays"
            label="Session lifetime"
            unit="days"
            min={1}
            max={90}
            description="Maximum age of a session, 1–90 days."
          />
          <NumberField
            control={form.control}
            name="sessionIdleDays"
            label="Idle timeout"
            unit="days"
            min={1}
            max={30}
            description="Sessions unused for this long expire, 1–30 days."
          />
        </FieldGrid>
      </FieldSection>
      <FieldSection title="Sign-in protection">
        <FieldGrid columns={3}>
          <NumberField
            control={form.control}
            name="maxFailedLogins"
            label="Failed attempts before lock"
            min={3}
            max={20}
          />
          <NumberField
            control={form.control}
            name="lockoutMinutes"
            label="Lock duration"
            unit="min"
            min={1}
            max={1440}
          />
          <NumberField
            control={form.control}
            name="loginRateLimitPerMinute"
            label="Sign-ins per IP"
            unit="/ min"
            min={3}
            max={200}
          />
          <NumberField
            control={form.control}
            name="passwordResetTtlMinutes"
            label="Reset link lifetime"
            unit="min"
            min={10}
            max={1440}
          />
        </FieldGrid>
      </FieldSection>
      <FieldSection title="Two-factor authentication">
        <SwitchField
          control={form.control}
          name="require2faForAdmins"
          label="Require 2FA for administrators"
          description="Users with admin permissions must enable two-factor authentication before they can use admin features."
        />
        {require2fa && !user.twoFactorEnabled ? (
          <Alert variant="warning">
            <AlertTitle>You don’t have 2FA enabled</AlertTitle>
            <AlertDescription>
              After saving, you will lose access to admin features until you enable two-factor authentication
              in Settings → Security.
            </AlertDescription>
          </Alert>
        ) : null}
      </FieldSection>
    </SettingsFormCard>
  );
}
