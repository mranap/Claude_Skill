'use client';

import { rulesSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { NumberField } from '@/components/shared/form';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { FieldGrid, SettingsFormCard } from '../settings-form-card';

export function RulesSettingsForm({
  values,
  readOnly,
}: {
  values: AdminSettingGroup<'rules'>;
  readOnly: boolean;
}) {
  const save = useSaveSettings('rules');
  const form = useForm({
    resolver: zodResolver(rulesSettingsSchema),
    values: pickSchemaValues(rulesSettingsSchema.shape, values),
  });

  return (
    <SettingsFormCard
      title="Auto rules"
      description="Limits that keep automated rules safe for your Meta rate limits."
      form={form}
      readOnly={readOnly}
      permission={managePermission('rules')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
    >
      <FieldGrid columns={3}>
        <NumberField
          control={form.control}
          name="minCheckIntervalMinutes"
          label="Minimum check interval"
          unit="min"
          min={15}
          max={1440}
          description="Rules rely on synced statistics; the default is 35 minutes."
        />
        <NumberField
          control={form.control}
          name="maxRulesPerUser"
          label="Rules per user"
          min={1}
          max={1000}
        />
        <NumberField
          control={form.control}
          name="maxEntitiesPerEvaluation"
          label="Entities per evaluation"
          min={10}
          max={5000}
          description="Campaigns, ad sets or ads one rule may touch per run."
        />
      </FieldGrid>
    </SettingsFormCard>
  );
}
