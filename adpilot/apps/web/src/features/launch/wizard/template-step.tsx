'use client';

import { templateSettingsSchema, variantSchema } from '@adpilot/shared';
import { useMutation } from '@tanstack/react-query';
import { Check, FilePlus2, LayoutTemplate } from 'lucide-react';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { TextField } from '@/components/shared/form';
import { RelativeTime } from '@/components/shared/relative-time';
import { getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { describeCountries } from '@/lib/utils/countries';
import { cn } from '@/lib/utils/cn';
import { defaultSettings, newKey, type SettingsInput, type VariantInput } from '../../campaign-settings/context';
import { SettingsSection } from '../../campaign-settings/fields';
import { templatesApi, useTemplates, type TemplateListItem } from '../../templates/api';
import { describeBudget } from '../../templates/templates-page';
import type { WizardValues } from './steps';

const storedConfig = z.object({ settings: templateSettingsSchema, variants: z.array(variantSchema) });

export function TemplateStep({ disabled }: { disabled?: boolean }) {
  const form = useFormContext<WizardValues>();
  const templateId = useWatch({ control: form.control, name: 'templateId' });
  const [query, setQuery] = useState('');
  const templates = useTemplates({ pageSize: 50, sort: 'lastUsedAt:desc', ...(query.trim() ? { q: query.trim() } : {}) });
  const [pending, setPending] = useState<TemplateListItem | 'scratch' | null>(null);
  const current = templates.data?.items.find((t) => t.id === templateId);

  const apply = useMutation({
    mutationFn: async (choice: TemplateListItem | 'scratch') => {
      if (choice === 'scratch') return { settings: defaultSettings(), variants: [] as VariantInput[], template: null };
      const detail = await templatesApi.get(choice.id);
      const parsed = storedConfig.safeParse(detail.config);
      if (!parsed.success) throw new Error('This template is invalid. Open it, fix the highlighted fields and save it again.');
      return { settings: parsed.data.settings as SettingsInput, variants: parsed.data.variants as VariantInput[], template: detail };
    },
    onSuccess: ({ settings, variants, template }) => {
      const opts = { shouldDirty: true };
      form.setValue('settings', settings, opts);
      // Groups and ads get fresh keys so they never collide with earlier launches of the same template.
      form.setValue(
        'variants',
        variants.map((v) => ({ ...v, key: newKey('g'), ads: (v.ads ?? []).map((ad) => ({ ...ad, key: newKey('a') })) })),
        opts,
      );
      form.setValue('templateId', template?.id, opts);
      if (template && !form.getValues('name')) form.setValue('name', template.name, opts);
      form.clearErrors();
      toast.success(template ? `Template “${template.name}” applied` : 'Starting from scratch', {
        description: template ? 'Settings and groups were copied into this launch. Changes here do not modify the template.' : 'All settings were reset to the defaults.',
      });
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  return (
    <div className="grid gap-4">
      <SettingsSection title="Launch" description="The launch name is used in the naming patterns ({name}) and in the launch history.">
        <TextField control={form.control} name="name" label="Launch name" required maxLength={150} placeholder="e.g. Autumn promo — PL/CZ" disabled={disabled} />
      </SettingsSection>
      <SettingsSection
        title="Start from"
        description="A template copies its campaign and ad set settings and its predefined groups into this launch. You can change everything afterwards."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => setPending('scratch')} disabled={disabled || apply.isPending}>
            <FilePlus2 />
            Start from scratch
          </Button>
        }
      >
        {templateId ? (
          <p className="text-sm text-muted-foreground">
            Currently based on <span className="font-medium text-foreground">{current?.name ?? 'a template'}</span>.
          </p>
        ) : null}
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates" className="h-9 sm:max-w-xs" aria-label="Search templates" />
        {templates.isLoading ? (
          <Skeleton className="h-40" />
        ) : templates.isError ? (
          <ErrorAlert error={templates.error} onRetry={() => void templates.refetch()} />
        ) : templates.data?.items.length ? (
          <ul className="grid gap-2 lg:grid-cols-2">
            {templates.data.items.map((t) => {
              const active = t.id === templateId;
              return (
                <li key={t.id} className={cn('flex items-start gap-3 rounded-lg border bg-field p-3', active && 'border-primary/60 ring-1 ring-primary/30')}>
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <LayoutTemplate className="size-4" />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.name}</span>
                      {active ? <Badge variant="default" size="sm">In use</Badge> : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t.objectiveLabel} · {describeBudget(t.budget)} · {describeCountries(t.countries)} · {t.variantsCount} groups
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.lastUsedAt ? <>Last used <RelativeTime value={t.lastUsedAt} /></> : 'Never used'}
                    </span>
                  </div>
                  <Button type="button" size="sm" variant={active ? 'outline' : 'secondary'} onClick={() => setPending(t)} disabled={disabled || apply.isPending} loading={apply.isPending && apply.variables === t}>
                    {active ? <Check /> : null}
                    {active ? 'Re-apply' : 'Use'}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={LayoutTemplate} title={query ? 'No templates match' : 'No templates yet'} description={query ? undefined : 'Continue from scratch — you can save templates on the Templates page.'} />
        )}
      </SettingsSection>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending === 'scratch' ? 'Reset all settings?' : `Apply “${pending?.name ?? ''}”?`}
        description="The campaign and ad set settings and the groups (with their ads) of this launch are replaced. The launch name and ad account stay as they are."
        confirmLabel={pending === 'scratch' ? 'Reset settings' : 'Apply template'}
        onConfirm={() => {
          if (pending) apply.mutate(pending);
        }}
      />
    </div>
  );
}
