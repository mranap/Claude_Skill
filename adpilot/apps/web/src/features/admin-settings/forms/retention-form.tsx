'use client';

import { retentionSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { NumberField } from '@/components/shared/form';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

export function RetentionSettingsForm({ values, readOnly }: { values: AdminSettingGroup<'retention'>; readOnly: boolean }) {
  const save = useSaveSettings('retention');
  const form = useForm({ resolver: zodResolver(retentionSettingsSchema), values: pickSchemaValues(retentionSettingsSchema.shape, values) });

  return (
    <SettingsFormCard
      title="Data retention"
      description="Older records are deleted by the nightly clean-up job. Statistics are kept longest so year-over-year reports keep working."
      form={form}
      readOnly={readOnly}
      permission={managePermission('retention')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
    >
      <FieldSection title="Logs & history">
        <FieldGrid columns={3}>
          <NumberField control={form.control} name="auditLogsDays" label="Audit log" unit="days" min={30} max={3650} />
          <NumberField control={form.control} name="systemLogsDays" label="System logs" unit="days" min={1} max={3650} />
          <NumberField control={form.control} name="metaApiLogsDays" label="Meta API logs" unit="days" min={1} max={3650} />
          <NumberField control={form.control} name="loginEventsDays" label="Login history" unit="days" min={7} max={3650} />
          <NumberField control={form.control} name="notificationsDays" label="Notifications" unit="days" min={7} max={3650} />
        </FieldGrid>
      </FieldSection>
      <FieldSection title="Product data">
        <FieldGrid columns={3}>
          <NumberField control={form.control} name="statisticsDays" label="Daily statistics" unit="days" min={30} max={3650} />
          <NumberField control={form.control} name="launchJobsDays" label="Launch jobs" unit="days" min={7} max={3650} />
          <NumberField control={form.control} name="ruleExecutionsDays" label="Rule executions" unit="days" min={7} max={3650} />
          <NumberField control={form.control} name="completedQueueJobsHours" label="Completed queue jobs" unit="hours" min={1} max={720} />
        </FieldGrid>
      </FieldSection>
    </SettingsFormCard>
  );
}
