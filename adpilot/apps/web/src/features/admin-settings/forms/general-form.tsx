'use client';

import { generalSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { FormField, TextField } from '@/components/shared/form';
import { TimeZoneSelect } from '@/components/shared/time-zone-select';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { FieldGrid, SettingsFormCard } from '../settings-form-card';

export function GeneralSettingsForm({ values, readOnly }: { values: AdminSettingGroup<'general'>; readOnly: boolean }) {
  const save = useSaveSettings('general');
  const form = useForm({
    resolver: zodResolver(generalSettingsSchema),
    values: pickSchemaValues(generalSettingsSchema.shape, values),
  });

  return (
    <SettingsFormCard
      title="General"
      description="Basic information shown in e-mails, the Telegram bot and the interface."
      form={form}
      readOnly={readOnly}
      permission={managePermission('general')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
    >
      <FieldGrid>
        <TextField control={form.control} name="platformName" label="Platform name" description="Used in e-mail subjects and the 2FA issuer name." maxLength={60} />
        <TextField
          control={form.control}
          name="supportEmail"
          label="Support e-mail"
          type="email"
          placeholder="support@company.com"
          description="Shown to users in e-mails. Leave empty to hide."
        />
        <FormField
          control={form.control}
          name="defaultTimezone"
          label="Default time zone"
          description="Pre-selected for new users."
          render={({ field, controlProps }) => (
            <TimeZoneSelect id={controlProps.id} value={field.value} onValueChange={field.onChange} disabled={readOnly} />
          )}
        />
      </FieldGrid>
    </SettingsFormCard>
  );
}
