'use client';

import {
  AUDIENCE_NETWORK_POSITIONS,
  DEVICE_PLATFORMS,
  EU_COUNTRY_CODES,
  FACEBOOK_POSITIONS,
  INSTAGRAM_POSITIONS,
  PLACEMENT_LABELS,
  PUBLISHER_PLATFORMS,
  THREADS_POSITIONS,
  placementIssues,
  type ManualPlacements,
} from '@adpilot/shared';
import { ExternalLink, Plus, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiCombobox } from '@/components/ui/multi-combobox';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { FormField } from '@/components/shared/form';
import { countryOptions } from '@/lib/utils/countries';
import { formatNumber } from '@/lib/utils/format';
import { useAudiences } from '../ad-accounts/api';
import { useSettingsForm, useSettingsUi } from './context';
import { CheckboxGroup, SelectInput, SettingsSection } from './fields';

const AGES = Array.from({ length: 65 - 13 + 1 }, (_, i) => i + 13);
export const COUNTRY_PRESETS = [{ label: 'All EU countries', values: [...EU_COUNTRY_CODES] }];

export function countrySelectOptions() {
  return countryOptions().map((c) => ({
    value: c.code,
    label: c.name,
    hint: c.code,
    keywords: c.eu ? ['eu', 'europe'] : undefined,
  }));
}

export function ageOptions(min = 13, max = 65) {
  return AGES.filter((a) => a >= min && a <= max).map((a) => ({
    value: String(a),
    label: a === 65 ? '65+' : String(a),
  }));
}

export function AudienceSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const advantage = useWatch({ control: form.control, name: 'settings.targeting.advantageAudience' });
  const audiences = useAudiences(ui.assetsAccountId);
  const audienceOptions = (audiences.data ?? []).map((a) => ({
    value: a.metaAudienceId,
    label: a.name,
    hint: a.approximateCountMax ? `~${formatNumber(a.approximateCountMax)}` : undefined,
  }));

  const setAdvantage = (on: boolean) => {
    form.setValue('settings.targeting.advantageAudience', on, { shouldDirty: true });
    if (on) {
      const min = form.getValues('settings.targeting.ageMin') ?? 18;
      form.setValue('settings.targeting.ageMin', Math.min(25, Math.max(18, min)), { shouldDirty: true });
      form.setValue('settings.targeting.ageMax', 65, { shouldDirty: true });
    }
  };

  return (
    <SettingsSection
      id="audience"
      title="Audience"
      description={
        ui.mode === 'template'
          ? 'Default targeting. Each language/geo group can override countries, languages, ages and gender.'
          : 'Default targeting of every ad set. Groups can override countries, languages, ages and gender.'
      }
    >
      <FormField
        control={form.control}
        name="settings.targeting.countries"
        label="Countries"
        description="Used by every group that does not choose its own countries."
        render={({ field, controlProps }) => (
          <MultiCombobox
            {...controlProps}
            value={field.value ?? []}
            onValueChange={field.onChange}
            options={countrySelectOptions()}
            presets={COUNTRY_PRESETS}
            placeholder="Select countries"
            addLabel="Add country"
            searchPlaceholder="Search countries or type EU"
            chipLabel={(o) => `${o.label}`}
            disabled={ui.disabled}
          />
        )}
      />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
        <FormField
          control={form.control}
          name="settings.targeting.ageMin"
          label="Minimum age"
          render={({ field, controlProps }) => (
            <SelectInput
              controlProps={controlProps}
              value={String(field.value ?? 18)}
              onChange={(v) => field.onChange(Number(v))}
              options={advantage ? ageOptions(18, 25) : ageOptions(13, 65)}
              disabled={ui.disabled}
            />
          )}
        />
        <FormField
          control={form.control}
          name="settings.targeting.ageMax"
          label="Maximum age"
          description={advantage ? 'Always 65+ with Advantage+ audience.' : undefined}
          render={({ field, controlProps }) => (
            <SelectInput
              controlProps={controlProps}
              value={String(field.value ?? 65)}
              onChange={(v) => field.onChange(Number(v))}
              options={ageOptions(13, 65)}
              disabled={ui.disabled || !!advantage}
            />
          )}
        />
        <FormField
          control={form.control}
          name="settings.targeting.genders"
          label="Gender"
          render={({ field }) => (
            <SegmentedControl
              aria-label="Gender"
              value={field.value ?? 'ALL'}
              onValueChange={field.onChange}
              disabled={ui.disabled}
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'MALE', label: 'Men' },
                { value: 'FEMALE', label: 'Women' },
              ]}
            />
          )}
        />
      </div>
      {ui.advanced ? (
        <>
          <FormField
            control={form.control}
            name="settings.targeting.advantageAudience"
            orientation="horizontal"
            label={
              <span className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary-fg" aria-hidden /> Advantage+ audience
              </span>
            }
            description="Meta may reach people beyond your suggestions. Minimum age must be 18–25 and the maximum is always 65+; gender, interests and custom audiences become suggestions."
            render={({ field, controlProps }) => (
              <Switch
                {...controlProps}
                checked={!!field.value}
                onCheckedChange={setAdvantage}
                disabled={ui.disabled}
              />
            )}
          />
          <FormField
            control={form.control}
            name="settings.targeting.locales"
            label="Languages"
            description="Meta locale keys (e.g. 6 = English (US)). Leave empty to target all languages."
            render={({ field }) => (
              <PairListEditor
                value={field.value ?? []}
                onChange={field.onChange}
                idKey="key"
                numeric
                idLabel="Locale key"
                nameLabel="Language"
                disabled={ui.disabled}
                docsHref="https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search#locales"
              />
            )}
          />
          <FormField
            control={form.control}
            name="settings.targeting.excludedCountries"
            label="Excluded countries"
            render={({ field, controlProps }) => (
              <MultiCombobox
                {...controlProps}
                value={field.value ?? []}
                onValueChange={field.onChange}
                options={countrySelectOptions()}
                placeholder="None"
                addLabel="Add country"
                searchPlaceholder="Search countries"
                disabled={ui.disabled}
              />
            )}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <FormField
              control={form.control}
              name="settings.targeting.customAudienceIds"
              label="Custom audiences"
              description={ui.assetsAccountId ? undefined : 'Choose an ad account to pick its audiences.'}
              render={({ field, controlProps }) => (
                <MultiCombobox
                  {...controlProps}
                  value={field.value ?? []}
                  onValueChange={field.onChange}
                  options={audienceOptions}
                  placeholder={audiences.isLoading ? 'Loading…' : 'None'}
                  addLabel="Add audience"
                  emptyText="No audiences in this ad account"
                  disabled={ui.disabled || !ui.assetsAccountId}
                />
              )}
            />
            <FormField
              control={form.control}
              name="settings.targeting.excludedCustomAudienceIds"
              label="Excluded audiences"
              render={({ field, controlProps }) => (
                <MultiCombobox
                  {...controlProps}
                  value={field.value ?? []}
                  onValueChange={field.onChange}
                  options={audienceOptions}
                  placeholder="None"
                  addLabel="Add audience"
                  emptyText="No audiences in this ad account"
                  disabled={ui.disabled || !ui.assetsAccountId}
                />
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="settings.targeting.interests"
            label="Detailed targeting (interests)"
            description="Interest ids from Meta's targeting search. Leave empty for broad targeting."
            render={({ field }) => (
              <PairListEditor
                value={field.value ?? []}
                onChange={field.onChange}
                idKey="id"
                idLabel="Interest id"
                nameLabel="Interest name"
                disabled={ui.disabled}
                docsHref="https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting#interests"
              />
            )}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

type Pair<K extends 'key' | 'id'> = K extends 'key'
  ? { key: number; name: string }
  : { id: string; name: string };

/** Editable list of `{ key|id, name }` pairs (Meta locales / interests entered by id). */
export function PairListEditor<K extends 'key' | 'id'>({
  value,
  onChange,
  idKey,
  numeric = false,
  idLabel,
  nameLabel,
  disabled,
  docsHref,
}: {
  value: Pair<K>[];
  onChange: (value: Pair<K>[]) => void;
  idKey: K;
  numeric?: boolean;
  idLabel: string;
  nameLabel: string;
  disabled?: boolean;
  docsHref?: string;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const valid = numeric ? /^\d{1,9}$/.test(id) && Number(id) > 0 : /^\d{1,30}$/.test(id);
  const add = () => {
    if (!valid) return;
    const item = (
      idKey === 'key'
        ? { key: Number(id), name: name.trim() || `Locale ${id}` }
        : { id, name: name.trim() || id }
    ) as Pair<K>;
    const exists = value.some((v) => String((v as Record<string, unknown>)[idKey]) === id);
    if (!exists) onChange([...value, item]);
    setId('');
    setName('');
  };
  return (
    <div className="grid gap-2">
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => {
            const k = String((v as Record<string, unknown>)[idKey]);
            return (
              <span
                key={k}
                className="inline-flex h-6 items-center gap-1 rounded bg-secondary pr-0.5 pl-2 text-xs font-medium"
              >
                {v.name} <span className="font-mono text-muted-foreground">{k}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange(value.filter((x) => String((x as Record<string, unknown>)[idKey]) !== k))
                  }
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${v.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={id}
          onChange={(e) => setId(e.target.value.replace(/\D/g, ''))}
          placeholder={idLabel}
          inputMode="numeric"
          className="h-8 w-32"
          aria-label={idLabel}
          disabled={disabled}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={nameLabel}
          className="h-8 min-w-40 flex-1"
          aria-label={nameLabel}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled || !valid}>
          <Plus />
          Add
        </Button>
        {docsHref ? (
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Find ids <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

const MANUAL_DEFAULT = {
  mode: 'MANUAL' as const,
  publisherPlatforms: ['facebook', 'instagram'] as ('facebook' | 'instagram')[],
  facebookPositions: [],
  instagramPositions: [],
  audienceNetworkPositions: [],
  threadsPositions: [],
  devicePlatforms: [],
};

const POSITIONS: Record<string, readonly string[]> = {
  facebook: FACEBOOK_POSITIONS,
  instagram: INSTAGRAM_POSITIONS,
  audience_network: AUDIENCE_NETWORK_POSITIONS,
  threads: THREADS_POSITIONS,
};
const POSITION_FIELD = {
  facebook: 'facebookPositions',
  instagram: 'instagramPositions',
  audience_network: 'audienceNetworkPositions',
  threads: 'threadsPositions',
} as const;

export function PlacementsSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const placements = useWatch({ control: form.control, name: 'settings.placements' }) as
    ({ mode: 'AUTOMATIC' } | ({ mode: 'MANUAL' } & Partial<ManualPlacements>)) | undefined;
  const manual = placements?.mode === 'MANUAL' ? placements : null;
  const issues = manual
    ? placementIssues({
        publisherPlatforms: manual.publisherPlatforms ?? [],
        facebookPositions: manual.facebookPositions ?? [],
        instagramPositions: manual.instagramPositions ?? [],
        audienceNetworkPositions: manual.audienceNetworkPositions ?? [],
        threadsPositions: manual.threadsPositions ?? [],
        devicePlatforms: manual.devicePlatforms ?? [],
      })
    : [];

  const setMode = (mode: string) => {
    form.setValue('settings.placements', mode === 'MANUAL' ? { ...MANUAL_DEFAULT } : { mode: 'AUTOMATIC' }, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  };

  return (
    <SettingsSection
      id="placements"
      title="Placements"
      description="Where the ads appear. Advantage+ placements let Meta pick the placements with the best results."
    >
      <RadioGroup
        value={placements?.mode ?? 'AUTOMATIC'}
        onValueChange={setMode}
        className="grid gap-2 sm:grid-cols-2"
        disabled={ui.disabled}
        aria-label="Placement mode"
      >
        <RadioCard
          value="AUTOMATIC"
          title="Advantage+ placements"
          description="Recommended. Ads can run on Facebook, Instagram, Audience Network and Threads."
        />
        <RadioCard
          value="MANUAL"
          title="Manual placements"
          description="Choose platforms, positions and devices yourself."
        />
      </RadioGroup>
      {manual ? (
        <div className="grid gap-5 rounded-lg border bg-surface-subtle p-4">
          <FormField
            control={form.control}
            name={'settings.placements.publisherPlatforms' as never}
            label="Platforms"
            render={({ field }) => (
              <CheckboxGroup
                value={(field.value as string[] | undefined) ?? []}
                onChange={field.onChange}
                disabled={ui.disabled}
                columns={2}
                options={PUBLISHER_PLATFORMS.map((p) => ({ value: p, label: PLACEMENT_LABELS[p] ?? p }))}
              />
            )}
          />
          {(manual.publisherPlatforms ?? []).map((platform) => {
            const name =
              `settings.placements.${POSITION_FIELD[platform as keyof typeof POSITION_FIELD]}` as never;
            return (
              <FormField
                key={platform}
                control={form.control}
                name={name}
                label={`${PLACEMENT_LABELS[platform] ?? platform} positions`}
                description="Leave all unchecked to use every position of this platform."
                render={({ field }) => (
                  <CheckboxGroup
                    value={(field.value as string[] | undefined) ?? []}
                    onChange={field.onChange}
                    disabled={ui.disabled}
                    columns={2}
                    options={(POSITIONS[platform] ?? []).map((pos) => ({
                      value: pos,
                      label: PLACEMENT_LABELS[`${platform}:${pos}`] ?? pos,
                    }))}
                  />
                )}
              />
            );
          })}
          <FormField
            control={form.control}
            name={'settings.placements.devicePlatforms' as never}
            label="Devices"
            description="Leave both unchecked for all devices."
            render={({ field }) => (
              <CheckboxGroup
                value={(field.value as string[] | undefined) ?? []}
                onChange={field.onChange}
                disabled={ui.disabled}
                columns={2}
                options={DEVICE_PLATFORMS.map((d) => ({ value: d, label: PLACEMENT_LABELS[d] ?? d }))}
              />
            )}
          />
          {issues.map((issue) => (
            <Alert
              key={`${issue.path}:${issue.message}`}
              variant={issue.severity === 'error' ? 'destructive' : 'warning'}
            >
              <AlertDescription className="text-foreground">{issue.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}
    </SettingsSection>
  );
}
