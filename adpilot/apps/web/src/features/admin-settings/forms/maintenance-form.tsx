'use client';

import { maintenanceSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FormField } from '@/components/shared/form';
import type { AdminSettingGroup } from '@/lib/api/types';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { SwitchField } from '../fields';
import { SettingsFormCard } from '../settings-form-card';

type Values = z.output<typeof maintenanceSettingsSchema>;

export function MaintenanceSettingsForm({ values, readOnly }: { values: AdminSettingGroup<'maintenance'>; readOnly: boolean }) {
  const save = useSaveSettings('maintenance');
  const form = useForm({
    resolver: zodResolver(maintenanceSettingsSchema),
    values: pickSchemaValues(maintenanceSettingsSchema.shape, values),
  });
  const enabled = useWatch({ control: form.control, name: 'enabled' });
  const message = useWatch({ control: form.control, name: 'message' });
  const [pending, setPending] = useState<{ values: Values; resolve: (saved: boolean) => void } | null>(null);

  // Turning maintenance on locks out every non-admin user, so it is confirmed separately.
  const submit = (v: Values): Promise<unknown> => {
    if (v.enabled && !values.enabled) {
      return new Promise<boolean>((resolve) => setPending({ values: v, resolve }));
    }
    return save.mutateAsync({ values: v });
  };

  return (
    <>
      <SettingsFormCard
        title="Maintenance"
        description="Use during upgrades or incidents. Administrators keep full access; everyone else sees the message below."
        form={form}
        readOnly={readOnly}
        permission={managePermission('maintenance')}
        onSubmit={submit}
        before={
          values.enabled ? (
            <Alert variant="warning">
              <AlertTitle>Maintenance mode is ON</AlertTitle>
              <AlertDescription>Regular users currently cannot use the platform.</AlertDescription>
            </Alert>
          ) : null
        }
      >
        <SwitchField
          control={form.control}
          name="enabled"
          label="Maintenance mode"
          description="Blocks API access for everyone without admin permissions. Background jobs keep running."
        />
        <FormField
          control={form.control}
          name="message"
          label="Message shown to users"
          render={({ field, controlProps }) => <Textarea {...field} {...controlProps} maxLength={500} rows={3} />}
        />
        <div className="rounded-lg border border-dashed p-4">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase">Preview</p>
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            {message || 'The platform is under maintenance. Please try again later.'}
          </div>
          {enabled !== values.enabled ? (
            <p className="mt-2 text-xs text-muted-foreground">Maintenance will be {enabled ? 'enabled' : 'disabled'} when you save.</p>
          ) : null}
        </div>
      </SettingsFormCard>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && pending) {
            pending.resolve(false);
            setPending(null);
          }
        }}
        title="Enable maintenance mode?"
        description="All users without admin permissions are locked out immediately and see your message. Running jobs continue."
        confirmLabel="Enable maintenance"
        destructive
        onConfirm={async () => {
          if (!pending) return;
          await save.mutateAsync({ values: pending.values });
          pending.resolve(true);
          setPending(null);
        }}
      />
    </>
  );
}
