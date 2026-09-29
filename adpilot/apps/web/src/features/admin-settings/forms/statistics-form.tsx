'use client';

import { statisticsSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NumberField } from '@/components/shared/form';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

const schema = statisticsSettingsSchema.refine(
  (v) => v.defaultSyncIntervalMinutes >= v.minSyncIntervalMinutes,
  {
    path: ['defaultSyncIntervalMinutes'],
    message: 'Must be at least the minimum interval',
  },
);

export function StatisticsSettingsForm({
  values,
  readOnly,
}: {
  values: AdminSettingGroup<'statistics'>;
  readOnly: boolean;
}) {
  const save = useSaveSettings('statistics');
  const form = useForm({
    resolver: zodResolver(schema),
    values: pickSchemaValues(statisticsSettingsSchema.shape, values),
  });

  return (
    <SettingsFormCard
      title="Statistics"
      description="How often insights are pulled from the Meta Marketing API."
      form={form}
      readOnly={readOnly}
      permission={managePermission('statistics')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
      before={
        <Alert variant="info">
          <AlertDescription className="text-foreground/80">
            The product default minimum is <span className="font-medium">35 minutes</span> between automatic
            syncs of the same ad account. Meta refreshes most insights a few times per hour and throttles
            heavy readers, so shorter intervals mainly burn rate limit without giving fresher numbers.
          </AlertDescription>
        </Alert>
      }
    >
      <FieldSection title="Automatic sync">
        <FieldGrid columns={3}>
          <NumberField
            control={form.control}
            name="minSyncIntervalMinutes"
            label="Minimum interval"
            unit="min"
            min={15}
            max={1440}
            description="Users cannot choose a shorter interval."
          />
          <NumberField
            control={form.control}
            name="defaultSyncIntervalMinutes"
            label="Default interval"
            unit="min"
            min={15}
            max={1440}
            description="Used for newly connected ad accounts."
          />
          <NumberField
            control={form.control}
            name="manualRefreshCooldownMinutes"
            label="Manual refresh cooldown"
            unit="min"
            min={1}
            max={1440}
          />
        </FieldGrid>
      </FieldSection>
      <FieldSection
        title="History"
        description="Meta revises recent days while attribution matures, so they are re-fetched on every sync."
      >
        <FieldGrid>
          <NumberField
            control={form.control}
            name="lookbackDays"
            label="Re-fetch window"
            unit="days"
            min={1}
            max={28}
          />
          <NumberField
            control={form.control}
            name="backfillDays"
            label="Initial backfill"
            unit="days"
            min={1}
            max={90}
            description="Fetched on the first sync of an ad account."
          />
        </FieldGrid>
      </FieldSection>
    </SettingsFormCard>
  );
}
