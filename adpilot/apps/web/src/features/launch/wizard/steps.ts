import { launchConfigSchema } from '@adpilot/shared';
import type { z } from 'zod';
import { defaultSettings, type SettingsInput, type VariantInput } from '../../campaign-settings/context';
import type { LaunchDraftDto, ValidationIssue } from '../types';

/** The wizard form holds exactly the launch configuration (validated with the shared schema). */
export const wizardSchema = launchConfigSchema;
export type WizardInput = z.input<typeof wizardSchema>;
export type WizardOutput = z.output<typeof wizardSchema>;

export interface WizardValues {
  version?: 1;
  name: string;
  profileId: string;
  adAccountId: string;
  templateId?: string;
  settings: SettingsInput;
  variants: VariantInput[];
}

export interface WizardStep {
  id: string;
  title: string;
  description: string;
}

export const WIZARD_STEPS: WizardStep[] = [
  { id: 'account', title: 'Account', description: 'Meta profile and ad account' },
  { id: 'template', title: 'Template', description: 'Start from a template or from scratch' },
  { id: 'campaign', title: 'Campaign', description: 'Objective, budget and bidding' },
  { id: 'adsets', title: 'Ad sets', description: 'Audience, placements and schedule' },
  { id: 'groups', title: 'Groups', description: 'Language / geo variants' },
  { id: 'ads', title: 'Ads', description: 'Creatives and texts' },
  { id: 'naming', title: 'Naming', description: 'Names, DSA and activation' },
  { id: 'review', title: 'Review', description: 'Validation and dry run' },
  { id: 'launch', title: 'Launch', description: 'Create everything at Meta' },
];

export const REVIEW_STEP = 7;
export const LAUNCH_STEP = 8;

const CAMPAIGN_KEYS = ['objective', 'destination', 'optimizationGoal', 'billingEvent', 'specialAdCategories', 'specialAdCategoryCountries', 'budget'];
const ADSET_KEYS = ['targeting', 'placements', 'schedule', 'conversion', 'identity', 'attribution'];
const NAMING_KEYS = ['naming', 'dsa', 'activateOnSuccess'];
const GROUP_KEYS = new Set(['key', 'label', 'countries', 'locales', 'budgetAmount', 'ageMin', 'ageMax', 'genders']);

/** Maps a validation path (client or server) to the wizard step where the field lives. */
export function stepOfPath(path: string): number {
  const p = path.replace(/^config\./, '');
  if (p === 'profileId' || p === 'adAccountId') return 0;
  if (p === 'name' || p === 'templateId') return 1;
  const s = /^settings\.([^.]+)/.exec(p);
  if (s) {
    const key = s[1]!;
    if (CAMPAIGN_KEYS.includes(key)) return 2;
    if (ADSET_KEYS.includes(key)) return 3;
    if (key === 'creative') return 5;
    if (NAMING_KEYS.includes(key)) return 6;
    return 2;
  }
  if (p === 'variants') return 4;
  const v = /^variants\.\d+(?:\.([^.]+))?/.exec(p);
  if (v) return !v[1] || GROUP_KEYS.has(v[1]) ? 4 : 5;
  return REVIEW_STEP;
}

/** Field names validated when leaving a step (react-hook-form `trigger`). */
export function stepFields(step: number, variants: VariantInput[]): string[] {
  switch (step) {
    case 0:
      return ['profileId', 'adAccountId'];
    case 1:
      return ['name'];
    case 2:
      return CAMPAIGN_KEYS.map((k) => `settings.${k}`);
    case 3:
      return ADSET_KEYS.map((k) => `settings.${k}`);
    case 4:
      return variants.flatMap((_, i) => [...GROUP_KEYS].map((k) => `variants.${i}.${k}`));
    case 5:
      return ['settings.creative', ...variants.map((_, i) => `variants.${i}.ads`)];
    case 6:
      return NAMING_KEYS.map((k) => `settings.${k}`);
    default:
      return [];
  }
}

export function issuesByStep(issues: ValidationIssue[]): Map<number, ValidationIssue[]> {
  const map = new Map<number, ValidationIssue[]>();
  for (const issue of issues) {
    const step = stepOfPath(issue.path);
    map.set(step, [...(map.get(step) ?? []), issue]);
  }
  return map;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Form values from a stored draft (drafts may be partial: missing parts get the defaults). */
export function valuesFromDraft(draft: LaunchDraftDto): WizardValues {
  const config = asRecord(draft.config);
  const settings = asRecord(config.settings);
  const defaults = defaultSettings();
  return {
    version: 1,
    name: typeof config.name === 'string' && config.name ? config.name : draft.name === 'Untitled launch' ? '' : draft.name,
    profileId: draft.profileId ?? (typeof config.profileId === 'string' ? config.profileId : ''),
    adAccountId: draft.adAccountId ?? (typeof config.adAccountId === 'string' ? config.adAccountId : ''),
    templateId: draft.templateId ?? (typeof config.templateId === 'string' ? config.templateId : undefined),
    settings: Object.keys(settings).length ? ({ ...defaults, ...settings } as SettingsInput) : defaults,
    variants: Array.isArray(config.variants) ? (config.variants as VariantInput[]) : [],
  };
}

export function draftStep(draft: LaunchDraftDto): number {
  const wizard = asRecord(asRecord(draft.config).wizard);
  const step = typeof wizard.step === 'number' ? wizard.step : 0;
  return Math.min(Math.max(0, step), LAUNCH_STEP);
}
