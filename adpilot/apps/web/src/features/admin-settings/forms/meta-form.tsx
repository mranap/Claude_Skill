'use client';

import { metaSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/shared/error-alert';
import { NumberField, TextField } from '@/components/shared/form';
import { KeyValueList } from '@/components/shared/key-value';
import type { AdminSettingGroup, SettingsEnvironment } from '@/lib/api/types';
import { adminSettingsApi, pickSchemaValues, secretPatch, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { SwitchField } from '../fields';
import { SecretField } from '../secret-field';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

const schema = metaSettingsSchema.refine((v) => v.pauseThresholdPct > v.throttleThresholdPct, {
  path: ['pauseThresholdPct'],
  message: 'Must be higher than the throttle threshold',
});

export function MetaSettingsForm({
  values,
  readOnly,
  environment,
}: {
  values: AdminSettingGroup<'meta'>;
  readOnly: boolean;
  environment: SettingsEnvironment;
}) {
  const save = useSaveSettings('meta');
  const form = useForm({ resolver: zodResolver(schema), values: pickSchemaValues(metaSettingsSchema.shape, values) });
  const [secrets, setSecrets] = useState<Record<string, string | null | undefined>>({});
  const patch = secretPatch(secrets);
  const test = useMutation({ mutationFn: adminSettingsApi.testMeta });
  const allowPrivate = useWatch({ control: form.control, name: 'allowPrivateProxyAddresses' });

  return (
    <SettingsFormCard
      title="Meta API"
      description="Marketing API app credentials and the rate-limit protection used by every worker."
      form={form}
      readOnly={readOnly}
      permission={managePermission('meta')}
      extraDirty={Object.keys(patch).length > 0}
      onDiscard={() => setSecrets({})}
      onSubmit={async (v) => {
        await save.mutateAsync({ values: v, secrets: patch });
        setSecrets({});
      }}
      footerActions={
        <Button type="button" variant="outline" onClick={() => test.mutate()} loading={test.isPending}>
          <PlugZap />
          Test connectivity
        </Button>
      }
      before={
        <>
          <div className="rounded-lg border bg-muted/30 p-4">
            <KeyValueList
              items={[
                { label: 'Graph API version', value: environment.metaGraphApiVersion, mono: true },
                { label: 'Configured by', value: 'META_GRAPH_API_VERSION environment variable' },
              ]}
            />
          </div>
          {test.data ? (
            <Alert variant={test.data.ok ? 'success' : 'destructive'}>
              <AlertTitle>{test.data.ok ? 'Graph API reachable' : 'Graph API not reachable'}</AlertTitle>
              <AlertDescription>
                {test.data.detail} · {test.data.latencyMs} ms · {test.data.version}
              </AlertDescription>
            </Alert>
          ) : null}
          {test.error ? <ErrorAlert error={test.error} title="Connectivity test failed" /> : null}
        </>
      }
    >
      <FieldSection title="App credentials" description="Used for token debugging and app-level calls. The secret is stored encrypted and never shown again.">
        <FieldGrid>
          <TextField control={form.control} name="appId" label="App ID" placeholder="1234567890" inputMode="numeric" autoComplete="off" />
          <SecretField
            label="App secret"
            isSet={!!values.appSecretSet}
            value={secrets.appSecret}
            onChange={(v) => setSecrets((s) => ({ ...s, appSecret: v }))}
            disabled={readOnly}
          />
        </FieldGrid>
      </FieldSection>
      <FieldSection title="Rate-limit protection" description="Based on Meta’s usage headers (X-Business-Use-Case-Usage, X-Ad-Account-Usage).">
        <FieldGrid columns={3}>
          <NumberField control={form.control} name="throttleThresholdPct" label="Slow down at" unit="%" min={10} max={99} />
          <NumberField control={form.control} name="pauseThresholdPct" label="Pause at" unit="%" min={20} max={100} />
          <NumberField control={form.control} name="maxConcurrentRequestsPerAccount" label="Parallel requests / account" min={1} max={20} />
        </FieldGrid>
      </FieldSection>
      <FieldSection
        title="Proxies"
        description="Meta profiles can send their Graph API traffic through an HTTP, HTTPS or SOCKS5 proxy entered by the user."
      >
        <SwitchField
          control={form.control}
          name="allowPrivateProxyAddresses"
          label="Allow proxies on private network addresses"
          description="Private, loopback and link-local addresses (10.0.0.0/8, 192.168.0.0/16, 127.0.0.1, 169.254.0.0/16…). Off by default: proxies are rejected with a proxy error."
        />
        {allowPrivate ? (
          <Alert variant="warning">
            <AlertTitle>Server-side request forgery risk</AlertTitle>
            <AlertDescription>
              Users can then make the server connect to hosts inside its own network (databases, metadata endpoints, admin panels) by entering them as a
              proxy. Only enable this when every user is trusted, for example to use a proxy running next to AdPilot.
            </AlertDescription>
          </Alert>
        ) : null}
      </FieldSection>
      <FieldSection title="Sync intervals">
        <FieldGrid columns={3}>
          <NumberField control={form.control} name="tokenCheckIntervalHours" label="Token health check" unit="hours" min={1} max={168} />
          <NumberField control={form.control} name="assetSyncIntervalHours" label="Assets sync" unit="hours" min={1} max={168} description="Pages, pixels, audiences." />
          <NumberField control={form.control} name="entitySyncIntervalMinutes" label="Campaign structure sync" unit="min" min={15} max={1440} />
        </FieldGrid>
      </FieldSection>
    </SettingsFormCard>
  );
}
