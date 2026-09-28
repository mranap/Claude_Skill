'use client';

import { backupSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { NumberField } from '@/components/shared/form';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { SelectField, SwitchField } from '../fields';
import { FieldGrid, SettingsFormCard } from '../settings-form-card';

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00 UTC`,
}));

export function BackupsSettingsForm({
  values,
  readOnly,
}: {
  values: AdminSettingGroup<'backups'>;
  readOnly: boolean;
}) {
  const save = useSaveSettings('backups');
  const form = useForm({
    resolver: zodResolver(backupSettingsSchema),
    values: pickSchemaValues(backupSettingsSchema.shape, values),
  });

  return (
    <SettingsFormCard
      title="Backups"
      description="Daily PostgreSQL dumps uploaded to the backup bucket. Pick a quiet hour."
      form={form}
      readOnly={readOnly}
      permission={managePermission('backups')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
    >
      <SwitchField
        control={form.control}
        name="enabled"
        label="Scheduled backups"
        description="Run a full database backup once a day."
      />
      <FieldGrid>
        <SelectField control={form.control} name="hourUtc" label="Time of day" numeric options={HOURS} />
        <NumberField
          control={form.control}
          name="keepLast"
          label="Keep last"
          unit="backups"
          min={1}
          max={365}
          description="Older backups are deleted automatically."
        />
      </FieldGrid>
    </SettingsFormCard>
  );
}
