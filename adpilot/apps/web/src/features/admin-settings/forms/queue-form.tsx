'use client';

import { queueSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { NumberField } from '@/components/shared/form';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

export function QueueSettingsForm({
  values,
  readOnly,
}: {
  values: AdminSettingGroup<'queue'>;
  readOnly: boolean;
}) {
  const save = useSaveSettings('queue');
  const form = useForm({
    resolver: zodResolver(queueSettingsSchema),
    values: pickSchemaValues(queueSettingsSchema.shape, values),
  });

  return (
    <SettingsFormCard
      title="Queues"
      description="Parallel jobs per worker process. Higher values finish faster but consume Meta rate limits sooner."
      form={form}
      readOnly={readOnly}
      permission={managePermission('queue')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
    >
      <FieldSection title="Concurrency">
        <FieldGrid columns={3}>
          <NumberField
            control={form.control}
            name="launchConcurrency"
            label="Campaign launches"
            min={1}
            max={50}
          />
          <NumberField
            control={form.control}
            name="statisticsConcurrency"
            label="Statistics sync"
            min={1}
            max={50}
          />
          <NumberField
            control={form.control}
            name="accountStatusConcurrency"
            label="Account status checks"
            min={1}
            max={50}
          />
          <NumberField
            control={form.control}
            name="metaSyncConcurrency"
            label="Meta structure sync"
            min={1}
            max={50}
          />
          <NumberField
            control={form.control}
            name="creativeUploadConcurrency"
            label="Creative uploads"
            min={1}
            max={20}
          />
          <NumberField control={form.control} name="rulesConcurrency" label="Auto rules" min={1} max={50} />
          <NumberField
            control={form.control}
            name="notificationConcurrency"
            label="Notifications"
            min={1}
            max={50}
          />
          <NumberField
            control={form.control}
            name="bulkConcurrency"
            label="Bulk operations"
            min={1}
            max={20}
          />
        </FieldGrid>
      </FieldSection>
    </SettingsFormCard>
  );
}
