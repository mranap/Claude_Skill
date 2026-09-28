'use client';

import { fileSettingsSchema, META_MEDIA_LIMITS } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { NumberField } from '@/components/shared/form';
import { KeyValueList } from '@/components/shared/key-value';
import type { AdminSettingGroup, SettingsEnvironment } from '@/lib/api/types';
import { formatBytes } from '@/lib/utils/format';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

const schema = fileSettingsSchema.refine((v) => v.maxUploadSizeMb >= Math.min(v.maxImageSizeMb, v.maxVideoSizeMb), {
  path: ['maxUploadSizeMb'],
  message: 'Should allow at least the smallest per-type limit',
});

export function FilesSettingsForm({
  values,
  readOnly,
  environment,
}: {
  values: AdminSettingGroup<'files'>;
  readOnly: boolean;
  environment: SettingsEnvironment;
}) {
  const save = useSaveSettings('files');
  const form = useForm({ resolver: zodResolver(schema), values: pickSchemaValues(fileSettingsSchema.shape, values) });
  const image = META_MEDIA_LIMITS.image;
  const video = META_MEDIA_LIMITS.video;

  return (
    <SettingsFormCard
      title="Files & storage"
      description="Limits for creative uploads and per-user storage."
      form={form}
      readOnly={readOnly}
      permission={managePermission('files')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
      before={
        <Alert variant="info">
          <AlertTitle>Hard maximums come from Meta</AlertTitle>
          <AlertDescription>
            Images: up to {image.maxSizeMb} MB ({image.extensions.join(', ').toUpperCase()}). Videos: up to{' '}
            {formatBytes(video.maxSizeMb * 1024 * 1024)} ({video.extensions.join(', ').toUpperCase()}). The limits below can only be
            stricter, so AdPilot never accepts a file Meta would reject.
          </AlertDescription>
        </Alert>
      }
    >
      <FieldSection title="Uploads">
        <FieldGrid columns={3}>
          <NumberField control={form.control} name="maxImageSizeMb" label="Max image size" unit="MB" min={1} max={image.maxSizeMb} description={`Meta limit: ${image.maxSizeMb} MB`} />
          <NumberField control={form.control} name="maxVideoSizeMb" label="Max video size" unit="MB" min={1} max={video.maxSizeMb} description={`Meta limit: ${video.maxSizeMb} MB`} />
          <NumberField control={form.control} name="maxUploadSizeMb" label="Max single upload" unit="MB" min={1} max={video.maxSizeMb} />
          <NumberField control={form.control} name="maxFilesPerUpload" label="Files per upload" min={1} max={100} />
        </FieldGrid>
      </FieldSection>
      <FieldSection title="Storage" description="Default quota per user; individual users can get a custom quota on their page.">
        <FieldGrid>
          <NumberField control={form.control} name="maxUserStorageMb" label="Default storage per user" unit="MB" min={10} max={10_000_000} description="20480 MB = 20 GB" />
        </FieldGrid>
        <div className="rounded-lg border bg-muted/30 p-4">
          <KeyValueList
            items={[
              { label: 'Bucket', value: environment.storageBucket, mono: true },
              { label: 'Endpoint', value: environment.storageEndpoint, mono: true },
            ]}
          />
          <p className="mt-3 text-xs text-muted-foreground">Object storage is configured with environment variables (S3_*).</p>
        </div>
      </FieldSection>
    </SettingsFormCard>
  );
}
