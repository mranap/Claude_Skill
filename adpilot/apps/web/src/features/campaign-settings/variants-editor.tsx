'use client';

import { Copy, Globe2, Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiCombobox } from '@/components/ui/multi-combobox';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState } from '@/components/shared/empty-state';
import { FormField } from '@/components/shared/form';
import { countryName } from '@/lib/utils/countries';
import { COUNTRY_PRESETS, ageOptions, countrySelectOptions } from './audience-section';
import { newKey, newVariant, useSettingsForm, useSettingsUi, type VariantInput } from './context';
import { AmountInput, SelectInput, SettingsSection } from './fields';
import { LocalePicker } from './targeting-pickers';

/**
 * Language/geo groups ("variants"): each one becomes an ad set with its own countries, languages,
 * optional budget and audience overrides. Ads are added per group in the launch wizard.
 */
export function VariantsEditor({
  title = 'Language / geo groups',
  description,
}: {
  title?: string;
  description?: string;
}) {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const { fields, append, remove, insert } = useFieldArray({ control: form.control, name: 'variants' });
  const [defaultCountries, budgetLevel] = useWatch({
    control: form.control,
    name: ['settings.targeting.countries', 'settings.budget.level'],
  });
  const rootError =
    (form.formState.errors.variants as { message?: string; root?: { message?: string } } | undefined)?.root
      ?.message ?? (form.formState.errors.variants as { message?: string } | undefined)?.message;

  const addPerCountry = () => {
    const existing = new Set(form.getValues('variants').flatMap((v) => v.countries ?? []));
    const countries = (defaultCountries ?? []).filter((c) => !existing.has(c));
    countries.forEach((c, i) => append({ ...newVariant(fields.length + i, [c]), label: countryName(c) }));
  };

  const duplicate = (index: number) => {
    const source = form.getValues(`variants.${index}`);
    insert(index + 1, {
      ...structuredClone(source),
      key: newKey('g'),
      label: `${source.label} (copy)`.slice(0, 60),
      ads: (source.ads ?? []).map((ad) => ({ ...structuredClone(ad), key: newKey('a') })),
    } as VariantInput);
  };

  return (
    <SettingsSection
      id="variants"
      title={title}
      description={
        description ??
        (ui.mode === 'template'
          ? 'Optional predefined groups; each becomes one ad set when the template is launched.'
          : 'Each group becomes one ad set with its own countries, languages and ads.')
      }
      actions={
        <div className="flex flex-wrap gap-2">
          {(defaultCountries?.length ?? 0) > 1 ? (
            <Button type="button" variant="outline" size="sm" onClick={addPerCountry} disabled={ui.disabled}>
              <Globe2 />
              One per country
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append(newVariant(fields.length))}
            disabled={ui.disabled || fields.length >= 50}
          >
            <Plus />
            Add group
          </Button>
        </div>
      }
    >
      {rootError ? (
        <p role="alert" className="text-sm font-medium text-destructive-fg">
          {rootError}
        </p>
      ) : null}
      {!fields.length ? (
        <EmptyState
          compact
          icon={Globe2}
          title="No groups yet"
          description={
            ui.mode === 'template'
              ? 'Without groups the launch starts with one group using the default targeting.'
              : 'Add at least one group. A single group with the default countries is the simplest launch.'
          }
          action={
            <Button type="button" size="sm" onClick={() => append(newVariant(0))} disabled={ui.disabled}>
              <Plus />
              Add group
            </Button>
          }
        />
      ) : (
        <ol className="grid gap-3">
          {fields.map((field, index) => (
            <li
              key={field.id}
              className="grid gap-4 rounded-lg border bg-surface-subtle p-4"
              data-testid="variant-card"
            >
              <div className="flex items-start gap-3">
                <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary-fg tabular-nums">
                  {index + 1}
                </span>
                <FormField
                  control={form.control}
                  name={`variants.${index}.label`}
                  className="min-w-0 flex-1"
                  render={({ field: f, controlProps }) => (
                    <Input
                      {...controlProps}
                      value={f.value ?? ''}
                      onChange={f.onChange}
                      onBlur={f.onBlur}
                      maxLength={60}
                      placeholder="Group name, e.g. Poland — Polish"
                      aria-label={`Name of group ${index + 1}`}
                      disabled={ui.disabled}
                    />
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => duplicate(index)}
                  aria-label={`Duplicate group ${index + 1}`}
                  disabled={ui.disabled}
                >
                  <Copy />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  aria-label={`Remove group ${index + 1}`}
                  disabled={ui.disabled}
                >
                  <Trash2 />
                </Button>
              </div>
              <FormField
                control={form.control}
                name={`variants.${index}.countries`}
                label="Countries"
                description={
                  defaultCountries?.length
                    ? `Empty = default countries (${defaultCountries.join(', ')}).`
                    : 'Select at least one country (or set default countries in the audience).'
                }
                render={({ field: f, controlProps }) => (
                  <MultiCombobox
                    {...controlProps}
                    value={f.value ?? []}
                    onValueChange={f.onChange}
                    options={countrySelectOptions()}
                    presets={COUNTRY_PRESETS}
                    placeholder="Default countries"
                    addLabel="Add country"
                    searchPlaceholder="Search countries"
                    disabled={ui.disabled}
                  />
                )}
              />
              <FormField
                control={form.control}
                name={`variants.${index}.locales`}
                label="Languages"
                render={({ field: f, controlProps }) => (
                  <LocalePicker
                    hint="Empty = default languages of the audience."
                    controlProps={controlProps}
                    value={f.value ?? []}
                    onChange={f.onChange}
                    adAccountId={ui.assetsAccountId}
                    disabled={ui.disabled}
                    placeholder="Default languages"
                  />
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {budgetLevel !== 'CAMPAIGN' ? (
                  <FormField
                    control={form.control}
                    name={`variants.${index}.budgetAmount`}
                    label="Budget override"
                    render={({ field: f, controlProps }) => (
                      <AmountInput
                        controlProps={controlProps}
                        value={f.value}
                        onChange={f.onChange}
                        currency={ui.currency}
                        optional
                        placeholder="Default"
                        disabled={ui.disabled}
                      />
                    )}
                  />
                ) : null}
                <FormField
                  control={form.control}
                  name={`variants.${index}.ageMin`}
                  label="Min age"
                  render={({ field: f, controlProps }) => (
                    <SelectInput
                      controlProps={controlProps}
                      value={f.value === undefined ? 'DEFAULT' : String(f.value)}
                      onChange={(v) => f.onChange(v === 'DEFAULT' ? undefined : Number(v))}
                      options={[{ value: 'DEFAULT', label: 'Default' }, ...ageOptions()]}
                      disabled={ui.disabled}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name={`variants.${index}.ageMax`}
                  label="Max age"
                  render={({ field: f, controlProps }) => (
                    <SelectInput
                      controlProps={controlProps}
                      value={f.value === undefined ? 'DEFAULT' : String(f.value)}
                      onChange={(v) => f.onChange(v === 'DEFAULT' ? undefined : Number(v))}
                      options={[{ value: 'DEFAULT', label: 'Default' }, ...ageOptions()]}
                      disabled={ui.disabled}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name={`variants.${index}.genders`}
                  label="Gender"
                  render={({ field: f }) => (
                    <SegmentedControl
                      aria-label={`Gender of group ${index + 1}`}
                      size="sm"
                      value={f.value ?? 'DEFAULT'}
                      onValueChange={(v) => f.onChange(v === 'DEFAULT' ? undefined : v)}
                      disabled={ui.disabled}
                      options={[
                        { value: 'DEFAULT', label: 'Default' },
                        { value: 'ALL', label: 'All' },
                        { value: 'MALE', label: 'Men' },
                        { value: 'FEMALE', label: 'Women' },
                      ]}
                    />
                  )}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </SettingsSection>
  );
}
