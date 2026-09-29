'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { templateCreateSchema, templateSettingsSchema, variantSchema } from '@adpilot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Rocket, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ErrorAlert } from '@/components/shared/error-alert';
import { FormField, FormRootError, TextField, applyServerErrors } from '@/components/shared/form';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/features/auth/auth-context';
import { queryKeys } from '@/lib/api/query-keys';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes';
import { useConnectedAdAccounts } from '../ad-accounts/api';
import { AudienceSection, PlacementsSection } from '../campaign-settings/audience-section';
import { BudgetSection, CampaignSection } from '../campaign-settings/campaign-section';
import {
  SettingsUiProvider,
  defaultSettings,
  type SettingsInput,
  type VariantInput,
} from '../campaign-settings/context';
import {
  ActivationSection,
  AttributionSection,
  ConversionSection,
  CreativeOptionsSection,
  DsaSection,
  IdentitySection,
  NamingSection,
  ScheduleSection,
} from '../campaign-settings/delivery-sections';
import { FormErrorSummary } from '../campaign-settings/error-summary';
import { VariantsEditor } from '../campaign-settings/variants-editor';
import { templatesApi, useTemplate, type TemplateDetail } from './api';

const editorSchema = z.object({
  name: templateCreateSchema.shape.name,
  description: z.string().trim().max(1000),
  settings: templateSettingsSchema,
  variants: z.array(variantSchema).max(50),
});
type EditorInput = z.input<typeof editorSchema>;
type EditorOutput = z.output<typeof editorSchema>;

export function TemplateEditorPage({ id }: { id?: string }) {
  const template = useTemplate(id);
  if (id && template.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (id && (template.isError || !template.data)) {
    return (
      <>
        <PageHeader
          title="Template"
          breadcrumbs={[{ label: 'Templates', href: '/templates' }, { label: 'Not available' }]}
        />
        <ErrorAlert error={template.error} onRetry={() => void template.refetch()} />
      </>
    );
  }
  return <TemplateEditor key={template.data?.updatedAt ?? 'new'} template={template.data} />;
}

function initialValues(template?: TemplateDetail): EditorInput {
  if (!template) return { name: '', description: '', settings: defaultSettings(), variants: [] };
  const parsed = z
    .object({ settings: templateSettingsSchema, variants: z.array(variantSchema) })
    .safeParse(template.config);
  return {
    name: template.name,
    description: template.description ?? '',
    settings: (parsed.success
      ? parsed.data.settings
      : (template.config.settings ?? defaultSettings())) as SettingsInput,
    variants: (parsed.success ? parsed.data.variants : (template.config.variants ?? [])) as VariantInput[],
  };
}

function TemplateEditor({ template }: { template?: TemplateDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can('app.templates.manage');
  const canLaunch = can('app.campaigns.launch');
  const accounts = useConnectedAdAccounts();
  const [advanced, setAdvanced] = useState(!!template);
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const assetsAccountId = pickedAccount ?? accounts.data?.[0]?.id ?? null;
  const form = useForm<EditorInput, unknown, EditorOutput>({
    resolver: zodResolver(editorSchema),
    defaultValues: initialValues(template),
    mode: 'onSubmit',
  });
  const name = useWatch({ control: form.control, name: 'name' });
  const variants = useWatch({ control: form.control, name: 'variants' });
  useUnsavedChangesWarning(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  const onValid = async (values: EditorOutput) => {
    const body = {
      name: values.name,
      description: values.description || undefined,
      config: { version: 1 as const, settings: values.settings, variants: values.variants },
    };
    try {
      const saved = template ? await templatesApi.update(template.id, body) : await templatesApi.create(body);
      queryClient.setQueryData(queryKeys.templates.detail(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.templates.all });
      toast.success(template ? 'Template saved' : 'Template created', { description: saved.name });
      form.reset(initialValues(saved));
      if (!template) router.replace(`/templates/${saved.id}`);
    } catch (error) {
      applyServerErrors(form, error, (path) => path.replace(/^config\./, ''));
    }
  };

  const onInvalid = () => {
    setAdvanced(true);
    toast.error('Some fields need your attention', {
      description: 'The problems are listed at the top of the form.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={form.handleSubmit(onValid, onInvalid)} className="grid gap-4">
        <PageHeader
          className="mb-2"
          breadcrumbs={[
            { label: 'Templates', href: '/templates' },
            { label: template ? template.name : 'New template' },
          ]}
          title={template ? name || template.name : 'New template'}
          meta={template?.isArchived ? <Badge variant="muted">Archived</Badge> : null}
          description="Campaign and ad set settings reused by launches. Money amounts are applied in the currency of the ad account chosen at launch."
          actions={
            <>
              <SegmentedControl
                aria-label="Detail level"
                value={advanced ? 'advanced' : 'basic'}
                onValueChange={(v) => setAdvanced(v === 'advanced')}
                options={[
                  { value: 'basic', label: 'Basic' },
                  { value: 'advanced', label: 'Advanced' },
                ]}
              />
              {template && canLaunch && !template.isArchived ? (
                <Button type="button" variant="outline" asChild>
                  <Link href={`/launch/new?template=${template.id}`}>
                    <Rocket />
                    Launch
                  </Link>
                </Button>
              ) : null}
              {canManage ? (
                <Button type="submit" loading={form.formState.isSubmitting}>
                  <Save />
                  {template ? 'Save template' : 'Create template'}
                </Button>
              ) : null}
            </>
          }
        />
        <FormRootError />
        <FormErrorSummary variantLabels={(variants ?? []).map((v) => v?.label)} />

        <SettingsUiProvider value={{ mode: 'template', advanced, assetsAccountId, disabled: !canManage }}>
          <Card>
            <CardHeader>
              <CardTitle>Template</CardTitle>
              <CardDescription>Name it after the use case, e.g. “Leads — website — PL/CZ”.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <TextField
                control={form.control}
                name="name"
                label="Name"
                required
                maxLength={120}
                placeholder="Leads — website — EU"
                disabled={!canManage}
              />
              <div className="grid content-start gap-2">
                <Label htmlFor="assets-account">Pages, pixels and audiences from</Label>
                <Select
                  value={assetsAccountId ?? ''}
                  onValueChange={setPickedAccount}
                  disabled={!accounts.data?.length}
                >
                  <SelectTrigger id="assets-account">
                    <SelectValue
                      placeholder={accounts.isLoading ? 'Loading ad accounts…' : 'No connected ad accounts'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts.data ?? []).map((a) => (
                      <SelectItem
                        key={a.id}
                        value={a.id}
                        description={`act_${a.metaAccountId} · ${a.currency}`}
                      >
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only used to offer choices in this editor; the template works with any ad account.
                </p>
              </div>
              <FormField
                control={form.control}
                name="description"
                label="Description"
                className="lg:col-span-2"
                render={({ field, controlProps }) => (
                  <Textarea
                    {...controlProps}
                    {...field}
                    rows={2}
                    maxLength={1000}
                    placeholder="Optional notes for your team"
                    disabled={!canManage}
                  />
                )}
              />
            </CardContent>
          </Card>
          <CampaignSection />
          <BudgetSection />
          <AudienceSection />
          <PlacementsSection />
          <IdentitySection />
          <ConversionSection />
          {advanced ? (
            <>
              <CreativeOptionsSection />
              <ScheduleSection />
              <AttributionSection />
              <DsaSection />
              <NamingSection sampleName={name} />
              <ActivationSection />
              <VariantsEditor title="Predefined language / geo groups" />
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-start gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Ad format, schedule, attribution, EU transparency, naming patterns, activation and
                  predefined groups are in the advanced settings.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setAdvanced(true)}>
                  Show advanced settings
                </Button>
              </CardContent>
            </Card>
          )}
        </SettingsUiProvider>

        {canManage ? (
          <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
            <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
              {form.formState.isDirty ? 'You have unsaved changes.' : 'All changes saved.'}
            </p>
            <Button type="button" variant="outline" onClick={() => router.push('/templates')}>
              {form.formState.isDirty ? 'Cancel' : 'Back to templates'}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {template ? 'Save template' : 'Create template'}
            </Button>
          </div>
        ) : null}
      </form>
    </FormProvider>
  );
}
