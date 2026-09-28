'use client';

import {
  CALL_TO_ACTIONS,
  CONVERSION_EVENTS,
  CONVERSION_EVENT_LABELS,
  targetsEu,
  type ConversionEvent,
} from '@adpilot/shared';
import { format } from 'date-fns';
import { useWatch } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { FormField } from '@/components/shared/form';
import { humanize } from '@/lib/utils/strings';
import { useAccountPages, usePixels } from '../ad-accounts/api';
import { useGoal, useSettingsForm, useSettingsUi } from './context';
import { OptionalInput, SelectInput, SettingsSection } from './fields';

function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, "yyyy-MM-dd'T'HH:mm");
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function ScheduleSection({ timezone }: { timezone?: string }) {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const type = useWatch({ control: form.control, name: 'settings.budget.type' });
  return (
    <SettingsSection
      id="schedule"
      title="Schedule"
      description={`Times are entered in your browser time zone${timezone ? `; Meta runs the schedule in the ad account time zone (${timezone})` : ''}.`}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="settings.schedule.startTime"
          label="Start"
          description="Empty = start as soon as the launch finishes."
          render={({ field, controlProps }) => (
            <Input {...controlProps} type="datetime-local" value={toLocalInput(field.value)} onChange={(e) => field.onChange(fromLocalInput(e.target.value))} disabled={ui.disabled} />
          )}
        />
        <FormField
          control={form.control}
          name="settings.schedule.endTime"
          label="End"
          required={type === 'LIFETIME'}
          description={type === 'LIFETIME' ? 'Required for lifetime budgets (at least 1 hour after the start).' : 'Optional.'}
          render={({ field, controlProps }) => (
            <Input {...controlProps} type="datetime-local" value={toLocalInput(field.value)} onChange={(e) => field.onChange(fromLocalInput(e.target.value))} disabled={ui.disabled} />
          )}
        />
      </div>
    </SettingsSection>
  );
}

/** Pixel + conversion event (only for goals that optimise for website conversions). */
export function ConversionSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const { rule } = useGoal();
  const pixels = usePixels(ui.assetsAccountId);
  if (rule?.promotedObject !== 'PIXEL_EVENT') return null;
  const events = (rule.events?.length ? rule.events : [...CONVERSION_EVENTS]) as ConversionEvent[];
  return (
    <SettingsSection id="conversion" title="Conversion tracking" description="The Pixel / dataset and the event this optimisation goal counts as a conversion.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="settings.conversion.pixelId"
          label="Pixel / dataset"
          required={ui.mode === 'launch'}
          description={!ui.assetsAccountId ? 'Choose an ad account to pick one of its pixels, or enter the id.' : undefined}
          render={({ field, controlProps }) =>
            ui.assetsAccountId && (pixels.data?.length ?? 0) > 0 ? (
              <SelectInput
                controlProps={controlProps}
                value={field.value}
                onChange={field.onChange}
                disabled={ui.disabled}
                placeholder="Choose a pixel"
                options={(pixels.data ?? []).map((p) => ({ value: p.metaPixelId, label: p.name, description: `${p.metaPixelId}${p.isUnavailable ? ' · unavailable' : ''}` }))}
              />
            ) : (
              <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} placeholder={pixels.isLoading ? 'Loading pixels…' : 'Pixel id'} inputMode="numeric" disabled={ui.disabled} />
            )
          }
        />
        <FormField
          control={form.control}
          name="settings.conversion.event"
          label="Conversion event"
          required={ui.mode === 'launch'}
          render={({ field, controlProps }) => (
            <SelectInput controlProps={controlProps} value={field.value} onChange={field.onChange} disabled={ui.disabled} placeholder="Choose an event" options={events.map((e) => ({ value: e, label: CONVERSION_EVENT_LABELS[e] }))} />
          )}
        />
      </div>
    </SettingsSection>
  );
}

export function IdentitySection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const pages = useAccountPages(ui.assetsAccountId);
  const pageId = useWatch({ control: form.control, name: 'settings.identity.pageId' });
  const page = pages.data?.find((p) => p.metaPageId === pageId);
  return (
    <SettingsSection id="identity" title="Identity" description="The Facebook Page (and optional Instagram account) the ads are published from.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="settings.identity.pageId"
          label="Facebook Page"
          required={ui.mode === 'launch'}
          description={!ui.assetsAccountId ? 'Choose an ad account to pick a page, or enter the page id.' : undefined}
          render={({ field, controlProps }) =>
            ui.assetsAccountId && (pages.data?.length ?? 0) > 0 ? (
              <SelectInput
                controlProps={controlProps}
                value={field.value}
                disabled={ui.disabled}
                placeholder="Choose a page"
                onChange={(v) => {
                  field.onChange(v);
                  const next = pages.data?.find((p) => p.metaPageId === v);
                  form.setValue('settings.identity.instagramUserId', next?.instagramUserId ?? undefined, { shouldDirty: true });
                }}
                options={(pages.data ?? []).map((p) => ({ value: p.metaPageId, label: p.name, description: `${p.metaPageId}${p.instagramUsername ? ` · @${p.instagramUsername}` : ''}` }))}
              />
            ) : (
              <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} placeholder={pages.isLoading ? 'Loading pages…' : 'Page id'} inputMode="numeric" disabled={ui.disabled} />
            )
          }
        />
        <FormField
          control={form.control}
          name="settings.identity.instagramUserId"
          label="Instagram account"
          description={page ? (page.instagramUserId ? undefined : 'This page has no linked Instagram account; Meta uses the page on Instagram.') : 'Empty = Meta uses the page for Instagram placements.'}
          render={({ field, controlProps }) =>
            page?.instagramUserId ? (
              <SelectInput
                controlProps={controlProps}
                value={field.value ?? 'PAGE'}
                disabled={ui.disabled}
                onChange={(v) => field.onChange(v === 'PAGE' ? undefined : v)}
                options={[
                  { value: page.instagramUserId, label: `@${page.instagramUsername ?? page.instagramUserId}` },
                  { value: 'PAGE', label: 'Use the Facebook Page' },
                ]}
              />
            ) : (
              <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} placeholder="Instagram account id (optional)" inputMode="numeric" disabled={ui.disabled} />
            )
          }
        />
      </div>
    </SettingsSection>
  );
}

export function AttributionSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const mode = useWatch({ control: form.control, name: 'settings.attribution.mode' });
  return (
    <SettingsSection id="attribution" title="Attribution" description="How conversions are attributed to ads. Default sends no setting, so Meta applies its standard window.">
      <FormField
        control={form.control}
        name="settings.attribution.mode"
        label="Attribution setting"
        render={({ field }) => (
          <SegmentedControl
            aria-label="Attribution setting"
            value={field.value ?? 'DEFAULT'}
            onValueChange={field.onChange}
            disabled={ui.disabled}
            options={[
              { value: 'DEFAULT', label: 'Meta default' },
              { value: 'CUSTOM', label: 'Custom window' },
            ]}
          />
        )}
      />
      {mode === 'CUSTOM' ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="settings.attribution.clickDays"
            label="Click-through"
            render={({ field }) => (
              <SegmentedControl<'1' | '7'>
                aria-label="Click-through window"
                value={String(field.value ?? 7) as '1' | '7'}
                onValueChange={(v) => field.onChange(Number(v))}
                disabled={ui.disabled}
                options={[
                  { value: '1', label: '1 day' },
                  { value: '7', label: '7 days' },
                ]}
              />
            )}
          />
          <FormField
            control={form.control}
            name="settings.attribution.engagedViewDays"
            label="Engage-through"
            render={({ field }) => (
              <SegmentedControl<'0' | '1'>
                aria-label="Engage-through window"
                value={String(field.value ?? 1) as '0' | '1'}
                onValueChange={(v) => field.onChange(Number(v))}
                disabled={ui.disabled}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '1', label: '1 day' },
                ]}
              />
            )}
          />
          <FormField
            control={form.control}
            name="settings.attribution.viewDays"
            label="View-through"
            render={({ field }) => (
              <SegmentedControl<'0' | '1'>
                aria-label="View-through window"
                value={String(field.value ?? 1) as '0' | '1'}
                onValueChange={(v) => field.onChange(Number(v))}
                disabled={ui.disabled}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '1', label: '1 day' },
                ]}
              />
            )}
          />
        </div>
      ) : null}
    </SettingsSection>
  );
}

/** EU Digital Services Act: who benefits from and who pays for the ads. */
export function DsaSection({ defaults }: { defaults?: { beneficiary: string | null; payor: string | null } }) {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const [countries, variants] = useWatch({ control: form.control, name: ['settings.targeting.countries', 'variants'] });
  const all = [...(countries ?? []), ...(variants ?? []).flatMap((v) => v.countries ?? [])];
  const eu = targetsEu(all);
  return (
    <SettingsSection
      id="dsa"
      title="EU transparency (DSA)"
      description="Ads delivered in the EU must name the beneficiary and the payer. Empty fields use the ad account defaults."
      actions={eu ? <Badge variant="info">EU targeted</Badge> : null}
    >
      {eu && !(defaults?.beneficiary && defaults?.payor) ? (
        <Alert variant="info">
          <AlertTitle>Required for this launch</AlertTitle>
          <AlertDescription>At least one group targets an EU country{defaults ? ' and the ad account has no complete DSA defaults' : ''}. Fill in both fields.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="settings.dsa.beneficiary"
          label="Beneficiary"
          description={defaults?.beneficiary ? `Account default: ${defaults.beneficiary}` : 'The person or organisation that benefits from the ads.'}
          render={({ field, controlProps }) => <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} maxLength={200} disabled={ui.disabled} />}
        />
        <FormField
          control={form.control}
          name="settings.dsa.payor"
          label="Payer"
          description={defaults?.payor ? `Account default: ${defaults.payor}` : 'The person or organisation that pays for the ads.'}
          render={({ field, controlProps }) => <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} maxLength={200} disabled={ui.disabled} />}
        />
      </div>
    </SettingsSection>
  );
}

const CTA_OPTIONS = CALL_TO_ACTIONS.map((c) => ({ value: c, label: c === 'NO_BUTTON' ? 'No button' : humanize(c) }));

export function CreativeOptionsSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const { destination, rule } = useGoal();
  return (
    <SettingsSection id="creative" title="Ad format & creative options" description="Defaults for every ad; texts, links and media are set per ad.">
      <FormField
        control={form.control}
        name="settings.creative.format"
        label="Format"
        description={rule?.requiresVideo ? 'ThruPlay optimisation requires video ads.' : undefined}
        render={({ field }) => (
          <RadioGroup value={field.value ?? 'SINGLE_VIDEO'} onValueChange={field.onChange} className="grid gap-2 sm:grid-cols-3" disabled={ui.disabled} aria-label="Ad format">
            <RadioCard value="SINGLE_IMAGE" title="Single image" disabled={rule?.requiresVideo} />
            <RadioCard value="SINGLE_VIDEO" title="Single video" />
            <RadioCard value="CAROUSEL" title="Carousel" description="2–10 cards" disabled={rule?.requiresVideo} />
          </RadioGroup>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="settings.creative.callToAction"
          label="Call to action"
          render={({ field, controlProps }) => <SelectInput controlProps={controlProps} value={field.value ?? 'LEARN_MORE'} onChange={field.onChange} options={CTA_OPTIONS} disabled={ui.disabled} />}
        />
        {destination === 'ON_AD' ? (
          <FormField
            control={form.control}
            name="settings.creative.leadFormId"
            label="Instant form id"
            description="Default lead form of every ad (an ad can use its own)."
            render={({ field, controlProps }) => <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} inputMode="numeric" placeholder="Lead form id" disabled={ui.disabled} />}
          />
        ) : null}
      </div>
      {ui.advanced ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="settings.creative.urlParameters"
              label="URL parameters"
              description="Appended to every link, e.g. utm_source=facebook&utm_campaign={{campaign.name}}"
              render={({ field, controlProps }) => <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} maxLength={1000} placeholder="utm_source=facebook" disabled={ui.disabled} />}
            />
            <FormField
              control={form.control}
              name="settings.creative.displayLink"
              label="Display link"
              render={({ field, controlProps }) => <OptionalInput controlProps={controlProps} value={field.value} onChange={field.onChange} maxLength={100} placeholder="example.com" disabled={ui.disabled} />}
            />
          </div>
          <FormField
            control={form.control}
            name="settings.creative.enhancements"
            label="Advantage+ creative enhancements"
            description="Off keeps every ad exactly as uploaded. Meta default lets Meta apply its standard enhancements (cropping, text variations, music…)."
            render={({ field }) => (
              <SegmentedControl
                aria-label="Creative enhancements"
                value={field.value ?? 'OFF'}
                onValueChange={field.onChange}
                disabled={ui.disabled}
                options={[
                  { value: 'OFF', label: 'Off' },
                  { value: 'META_DEFAULT', label: 'Meta default' },
                ]}
              />
            )}
          />
          <FormField
            control={form.control}
            name="settings.creative.multiAdvertiserAds"
            orientation="horizontal"
            label="Multi-advertiser ads"
            description="Allow the ads to appear alongside ads from other businesses."
            render={({ field, controlProps }) => <Switch {...controlProps} checked={!!field.value} onCheckedChange={field.onChange} disabled={ui.disabled} />}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

const PLACEHOLDERS: Record<string, string> = {
  '{name}': 'launch name',
  '{date}': 'launch date (account time zone)',
  '{code}': 'unique launch code',
  '{objective}': 'objective',
  '{variant}': 'group label',
  '{countries}': 'group countries',
  '{creative}': 'creative file name',
  '{n}': 'ad number in the group',
};

export function renderPreview(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m).replace(/\s+/g, ' ').trim();
}

export function NamingSection({ sampleName }: { sampleName?: string }) {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const [naming, objective, firstVariant] = useWatch({ control: form.control, name: ['settings.naming', 'settings.objective', 'variants.0'] });
  const vars = {
    name: sampleName || 'Spring sale',
    date: format(new Date(), 'yyyy-MM-dd'),
    code: 'K7Q2MX',
    objective: objective ?? 'OUTCOME_LEADS',
    variant: firstVariant?.label ?? 'Group 1',
    countries: (firstVariant?.countries ?? []).join(',') || 'PL',
    creative: 'summer-video',
    n: '1',
  };
  const fields = [
    { name: 'settings.naming.campaign' as const, label: 'Campaign name', value: naming?.campaign },
    { name: 'settings.naming.adSet' as const, label: 'Ad set names', value: naming?.adSet },
    { name: 'settings.naming.ad' as const, label: 'Ad names', value: naming?.ad },
  ];
  return (
    <SettingsSection id="naming" title="Naming" description="Patterns for the names created at Meta.">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(PLACEHOLDERS).map(([token, label]) => (
          <Badge key={token} variant="outline" className="font-normal" title={label}>
            <span className="font-mono">{token}</span>
            <span className="text-muted-foreground">{label}</span>
          </Badge>
        ))}
      </div>
      {fields.map((f) => (
        <FormField
          key={f.name}
          control={form.control}
          name={f.name}
          label={f.label}
          description={f.value ? <>Preview: <span className="font-medium text-foreground">{renderPreview(f.value, vars)}</span></> : undefined}
          render={({ field, controlProps }) => <Input {...controlProps} value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} maxLength={200} className="font-mono text-[13px]" disabled={ui.disabled} />}
        />
      ))}
    </SettingsSection>
  );
}

export function ActivationSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  return (
    <SettingsSection id="activation" title="Activation" description="Everything is created paused first, so nothing spends before the whole structure exists.">
      <FormField
        control={form.control}
        name="settings.activateOnSuccess"
        orientation="horizontal"
        label="Activate after a successful launch"
        description="When on, the campaign, ad sets and ads are switched to active once every object was created and verified. When off, they stay paused for review in Ads Manager."
        render={({ field, controlProps }) => <Switch {...controlProps} checked={!!field.value} onCheckedChange={field.onChange} disabled={ui.disabled} />}
      />
    </SettingsSection>
  );
}
