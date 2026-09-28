'use client';

import { CALL_TO_ACTIONS, destinationNeedsLink, type Destination } from '@adpilot/shared';
import { ChevronDown, Copy, CopyPlus, Megaphone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared/empty-state';
import { FormField } from '@/components/shared/form';
import { cn } from '@/lib/utils/cn';
import { humanize } from '@/lib/utils/strings';
import { newKey, type VariantInput } from '../../campaign-settings/context';
import { OptionalInput, SelectInput, SettingsSection } from '../../campaign-settings/fields';
import { CreativeField } from '../../creatives/creative-picker';
import type { WizardValues } from './steps';

type AdInput = NonNullable<VariantInput['ads']>[number];

export function newAd(): AdInput {
  return { key: newKey('a'), primaryText: '', cards: [] };
}

function Counter({ value, soft }: { value: string | undefined; soft: number }) {
  const length = value?.length ?? 0;
  return (
    <span className={cn('text-xs tabular-nums', length > soft ? 'text-warning-fg' : 'text-muted-foreground')}>
      {length}/{soft}
    </span>
  );
}

/** Ads of every group: creative + texts + link (+ per-ad overrides). */
export function AdsEditor({ disabled }: { disabled?: boolean }) {
  const form = useFormContext<WizardValues>();
  const variants = useWatch({ control: form.control, name: 'variants' }) ?? [];
  if (!variants.length) {
    return (
      <SettingsSection title="Ads" description="Ads are created per language/geo group.">
        <EmptyState
          compact
          icon={Megaphone}
          title="Add a group first"
          description="Go back to the Groups step and add at least one language/geo group."
        />
      </SettingsSection>
    );
  }
  return (
    <div className="grid gap-4">
      {variants.map((variant, index) => (
        <GroupAds
          key={variant.key ?? index}
          index={index}
          label={variant.label}
          countries={variant.countries ?? []}
          disabled={disabled}
          groupCount={variants.length}
        />
      ))}
    </div>
  );
}

function GroupAds({
  index,
  label,
  countries,
  disabled,
  groupCount,
}: {
  index: number;
  label: string;
  countries: string[];
  disabled?: boolean;
  groupCount: number;
}) {
  const form = useFormContext<WizardValues>();
  const { fields, append, remove, insert } = useFieldArray({
    control: form.control,
    name: `variants.${index}.ads`,
  });
  const adsError = form.formState.errors.variants?.[index]?.ads as
    { message?: string; root?: { message?: string } } | undefined;

  const copyToAll = () => {
    const ads = form.getValues(`variants.${index}.ads`) ?? [];
    const all = form.getValues('variants');
    all.forEach((_, i) => {
      if (i === index) return;
      form.setValue(
        `variants.${i}.ads`,
        ads.map((ad) => ({ ...structuredClone(ad), key: newKey('a') })),
        { shouldDirty: true },
      );
    });
    toast.success(`Ads copied to ${groupCount - 1} other ${groupCount - 1 === 1 ? 'group' : 'groups'}`, {
      description: 'Translate the texts per group if needed.',
    });
  };

  return (
    <SettingsSection
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{label || `Group ${index + 1}`}</span>
          {countries.length ? <Badge variant="outline">{countries.join(', ')}</Badge> : null}
        </span>
      }
      description={`${fields.length} ${fields.length === 1 ? 'ad' : 'ads'} in this ad set.`}
      actions={
        <div className="flex flex-wrap gap-2">
          {groupCount > 1 && fields.length ? (
            <Button type="button" variant="outline" size="sm" onClick={copyToAll} disabled={disabled}>
              <CopyPlus />
              Copy ads to all groups
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append(newAd())}
            disabled={disabled || fields.length >= 50}
          >
            <Plus />
            Add ad
          </Button>
        </div>
      }
    >
      {adsError?.message || adsError?.root?.message ? (
        <p role="alert" className="text-sm font-medium text-destructive-fg">
          {adsError.message ?? adsError.root?.message}
        </p>
      ) : null}
      {!fields.length ? (
        <EmptyState
          compact
          icon={Megaphone}
          title="No ads in this group"
          action={
            <Button type="button" size="sm" onClick={() => append(newAd())} disabled={disabled}>
              <Plus />
              Add ad
            </Button>
          }
        />
      ) : (
        <ol className="grid gap-3">
          {fields.map((field, adIndex) => (
            <AdCard
              key={field.id}
              variantIndex={index}
              adIndex={adIndex}
              disabled={disabled}
              onRemove={() => remove(adIndex)}
              onDuplicate={() =>
                insert(adIndex + 1, {
                  ...(structuredClone(form.getValues(`variants.${index}.ads.${adIndex}`)) as AdInput),
                  key: newKey('a'),
                })
              }
            />
          ))}
        </ol>
      )}
    </SettingsSection>
  );
}

const CTA_LABEL = (c: string) => (c === 'NO_BUTTON' ? 'No button' : humanize(c));

function AdCard({
  variantIndex,
  adIndex,
  disabled,
  onRemove,
  onDuplicate,
}: {
  variantIndex: number;
  adIndex: number;
  disabled?: boolean;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const form = useFormContext<WizardValues>();
  const base = `variants.${variantIndex}.ads.${adIndex}` as const;
  const [format, destination, defaultCta] = useWatch({
    control: form.control,
    name: ['settings.creative.format', 'settings.destination', 'settings.creative.callToAction'],
  });
  const [primaryText, headline] = useWatch({
    control: form.control,
    name: [`${base}.primaryText`, `${base}.headline`],
  });
  const [more, setMore] = useState(false);
  const needsLink = destination
    ? destinationNeedsLink(destination as Destination) && destination === 'WEBSITE'
    : false;
  const carousel = format === 'CAROUSEL';

  return (
    <li className="grid gap-4 rounded-lg border bg-surface-subtle p-4" data-testid="ad-card">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Ad {adIndex + 1}</span>
        <span className="ml-auto" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDuplicate}
          disabled={disabled}
          aria-label={`Duplicate ad ${adIndex + 1}`}
        >
          <Copy />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ad ${adIndex + 1}`}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {carousel ? (
          <CarouselCards control={form.control} base={base} disabled={disabled} needsLink={needsLink} />
        ) : (
          <FormField
            control={form.control}
            name={`${base}.creativeFileId`}
            label={format === 'SINGLE_IMAGE' ? 'Image' : 'Video'}
            required
            render={({ field, controlProps }) => (
              <CreativeField
                id={controlProps.id}
                invalid={controlProps['aria-invalid']}
                value={field.value}
                onChange={field.onChange}
                type={format === 'SINGLE_IMAGE' ? 'IMAGE' : 'VIDEO'}
                disabled={disabled}
              />
            )}
          />
        )}
        <div className="grid content-start gap-4">
          <FormField
            control={form.control}
            name={`${base}.primaryText`}
            label="Primary text"
            required
            labelAction={<Counter value={primaryText} soft={125} />}
            render={({ field, controlProps }) => (
              <Textarea
                {...controlProps}
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                rows={3}
                maxLength={2200}
                placeholder="The main text above the media"
                disabled={disabled}
              />
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name={`${base}.headline`}
              label="Headline"
              labelAction={<Counter value={headline} soft={40} />}
              render={({ field, controlProps }) => (
                <OptionalInput
                  controlProps={controlProps}
                  value={field.value}
                  onChange={field.onChange}
                  maxLength={255}
                  placeholder="Short and clear"
                  disabled={disabled}
                />
              )}
            />
            <FormField
              control={form.control}
              name={`${base}.description`}
              label="Description"
              render={({ field, controlProps }) => (
                <OptionalInput
                  controlProps={controlProps}
                  value={field.value}
                  onChange={field.onChange}
                  maxLength={255}
                  placeholder="Optional"
                  disabled={disabled}
                />
              )}
            />
          </div>
          <FormField
            control={form.control}
            name={`${base}.link`}
            label="Website URL"
            required={needsLink && !carousel}
            description={carousel ? 'Used for cards without their own link.' : undefined}
            render={({ field, controlProps }) => (
              <OptionalInput
                controlProps={controlProps}
                value={field.value}
                onChange={field.onChange}
                type="url"
                inputMode="url"
                maxLength={2000}
                placeholder="https://example.com/landing"
                disabled={disabled}
              />
            )}
          />
          <Collapsible open={more} onOpenChange={setMore}>
            <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              More options for this ad
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-4 pt-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name={`${base}.name`}
                  label="Ad name"
                  description="Empty = naming pattern."
                  render={({ field, controlProps }) => (
                    <OptionalInput
                      controlProps={controlProps}
                      value={field.value}
                      onChange={field.onChange}
                      maxLength={150}
                      disabled={disabled}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name={`${base}.callToAction`}
                  label="Call to action"
                  render={({ field, controlProps }) => (
                    <SelectInput
                      controlProps={controlProps}
                      value={field.value ?? 'DEFAULT'}
                      onChange={(v) => field.onChange(v === 'DEFAULT' ? undefined : v)}
                      disabled={disabled}
                      options={[
                        { value: 'DEFAULT', label: `Default (${CTA_LABEL(defaultCta ?? 'LEARN_MORE')})` },
                        ...CALL_TO_ACTIONS.map((c) => ({ value: c, label: CTA_LABEL(c) })),
                      ]}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name={`${base}.urlParameters`}
                  label="URL parameters"
                  description="Overrides the default URL parameters."
                  render={({ field, controlProps }) => (
                    <OptionalInput
                      controlProps={controlProps}
                      value={field.value}
                      onChange={field.onChange}
                      maxLength={1000}
                      placeholder="utm_content=ad1"
                      disabled={disabled}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name={`${base}.displayLink`}
                  label="Display link"
                  render={({ field, controlProps }) => (
                    <OptionalInput
                      controlProps={controlProps}
                      value={field.value}
                      onChange={field.onChange}
                      maxLength={100}
                      disabled={disabled}
                    />
                  )}
                />
                {destination === 'ON_AD' ? (
                  <FormField
                    control={form.control}
                    name={`${base}.leadFormId`}
                    label="Instant form id"
                    description="Overrides the default lead form."
                    render={({ field, controlProps }) => (
                      <OptionalInput
                        controlProps={controlProps}
                        value={field.value}
                        onChange={field.onChange}
                        inputMode="numeric"
                        disabled={disabled}
                      />
                    )}
                  />
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </li>
  );
}

function CarouselCards({
  control,
  base,
  disabled,
  needsLink,
}: {
  control: Control<WizardValues>;
  base: `variants.${number}.ads.${number}`;
  disabled?: boolean;
  needsLink: boolean;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: `${base}.cards` });
  return (
    <div className="grid content-start gap-3">
      <p className="text-sm font-medium">Carousel cards</p>
      {fields.map((field, i) => (
        <div key={field.id} className="grid gap-2 rounded-md border bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Card {i + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => remove(i)}
              disabled={disabled}
              aria-label={`Remove card ${i + 1}`}
            >
              <Trash2 />
            </Button>
          </div>
          <FormField
            control={control}
            name={`${base}.cards.${i}.creativeFileId`}
            render={({ field: f, controlProps }) => (
              <CreativeField
                id={controlProps.id}
                invalid={controlProps['aria-invalid']}
                value={f.value}
                onChange={(v) => f.onChange(v ?? '')}
                type="IMAGE"
                disabled={disabled}
              />
            )}
          />
          <FormField
            control={control}
            name={`${base}.cards.${i}.headline`}
            render={({ field: f, controlProps }) => (
              <OptionalInput
                controlProps={controlProps}
                value={f.value}
                onChange={f.onChange}
                placeholder="Card headline"
                maxLength={255}
                aria-label={`Card ${i + 1} headline`}
                disabled={disabled}
              />
            )}
          />
          <FormField
            control={control}
            name={`${base}.cards.${i}.link`}
            render={({ field: f, controlProps }) => (
              <OptionalInput
                controlProps={controlProps}
                value={f.value}
                onChange={f.onChange}
                placeholder={needsLink ? 'Card link (optional if the ad has one)' : 'Card link'}
                type="url"
                aria-label={`Card ${i + 1} link`}
                disabled={disabled}
              />
            )}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ creativeFileId: '' })}
        disabled={disabled || fields.length >= 10}
        className="w-fit"
      >
        <Plus />
        Add card
      </Button>
      {fields.length < 2 ? (
        <p className="text-xs text-muted-foreground">A carousel needs 2–10 cards.</p>
      ) : null}
    </div>
  );
}
