import type { FieldErrors, FieldValues } from 'react-hook-form';
import { humanize } from '@/lib/utils/strings';

const LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  profileId: 'Meta profile',
  adAccountId: 'Ad account',
  templateId: 'Template',
  'settings.objective': 'Objective',
  'settings.destination': 'Conversion location',
  'settings.optimizationGoal': 'Optimization goal',
  'settings.billingEvent': 'Billing event',
  'settings.specialAdCategories': 'Special ad categories',
  'settings.specialAdCategoryCountries': 'Special ad category countries',
  'settings.budget': 'Budget',
  'settings.budget.level': 'Budget level',
  'settings.budget.type': 'Budget type',
  'settings.budget.amount': 'Budget amount',
  'settings.budget.bidStrategy': 'Bid strategy',
  'settings.budget.bidAmount': 'Cost goal / bid cap',
  'settings.budget.roasFloor': 'Minimum ROAS',
  'settings.budget.budgetSharing': 'Budget sharing',
  'settings.budget.spendCap': 'Spend limit',
  'settings.schedule.startTime': 'Start time',
  'settings.schedule.endTime': 'End time',
  'settings.targeting': 'Audience',
  'settings.targeting.countries': 'Countries',
  'settings.targeting.excludedCountries': 'Excluded countries',
  'settings.targeting.ageMin': 'Minimum age',
  'settings.targeting.ageMax': 'Maximum age',
  'settings.targeting.genders': 'Gender',
  'settings.targeting.locales': 'Languages',
  'settings.targeting.advantageAudience': 'Advantage+ audience',
  'settings.targeting.customAudienceIds': 'Custom audiences',
  'settings.targeting.excludedCustomAudienceIds': 'Excluded audiences',
  'settings.targeting.interests': 'Interests',
  'settings.placements': 'Placements',
  'settings.placements.publisherPlatforms': 'Placement platforms',
  'settings.placements.facebookPositions': 'Facebook positions',
  'settings.placements.instagramPositions': 'Instagram positions',
  'settings.placements.threadsPositions': 'Threads positions',
  'settings.placements.devicePlatforms': 'Devices',
  'settings.conversion.pixelId': 'Pixel',
  'settings.conversion.event': 'Conversion event',
  'settings.identity.pageId': 'Facebook Page',
  'settings.identity.instagramUserId': 'Instagram account',
  'settings.attribution': 'Attribution',
  'settings.dsa': 'EU beneficiary and payer',
  'settings.dsa.beneficiary': 'DSA beneficiary',
  'settings.dsa.payor': 'DSA payer',
  'settings.creative.format': 'Ad format',
  'settings.creative.callToAction': 'Call to action',
  'settings.creative.urlParameters': 'URL parameters',
  'settings.creative.displayLink': 'Display link',
  'settings.creative.leadFormId': 'Instant form',
  'settings.creative.enhancements': 'Creative enhancements',
  'settings.naming.campaign': 'Campaign name pattern',
  'settings.naming.adSet': 'Ad set name pattern',
  'settings.naming.ad': 'Ad name pattern',
  'settings.activateOnSuccess': 'Activation',
  variants: 'Language / geo groups',
};

const VARIANT_FIELDS: Record<string, string> = {
  key: 'Key',
  label: 'Name',
  countries: 'Countries',
  locales: 'Languages',
  budgetAmount: 'Budget',
  ageMin: 'Minimum age',
  ageMax: 'Maximum age',
  genders: 'Gender',
  ads: 'Ads',
};

const AD_FIELDS: Record<string, string> = {
  key: 'Key',
  name: 'Ad name',
  creativeFileId: 'Creative',
  cards: 'Carousel cards',
  primaryText: 'Primary text',
  headline: 'Headline',
  description: 'Description',
  link: 'Website URL',
  callToAction: 'Call to action',
  urlParameters: 'URL parameters',
  displayLink: 'Display link',
  leadFormId: 'Instant form',
};

/** Human label for a form/validation path ("variants.1.ads.0.primaryText" → "Group 2 · Ad 1 · Primary text"). */
export function describePath(path: string, variantLabels: (string | undefined)[] = []): string {
  const clean = path.replace(/^config\./, '');
  if (LABELS[clean]) return LABELS[clean]!;
  const m = /^variants\.(\d+)(?:\.(.+))?$/.exec(clean);
  if (m) {
    const index = Number(m[1]);
    const group = variantLabels[index] ? `“${variantLabels[index]}”` : `Group ${index + 1}`;
    const rest = m[2];
    if (!rest) return group;
    const ad = /^ads\.(\d+)(?:\.(.+))?$/.exec(rest);
    if (ad) {
      const adLabel = `Ad ${Number(ad[1]) + 1}`;
      if (!ad[2]) return `${group} · ${adLabel}`;
      const card = /^cards\.(\d+)(?:\.(.+))?$/.exec(ad[2]);
      if (card)
        return `${group} · ${adLabel} · Card ${Number(card[1]) + 1}${card[2] ? ` · ${AD_FIELDS[card[2]] ?? humanize(card[2])}` : ''}`;
      return `${group} · ${adLabel} · ${AD_FIELDS[ad[2]] ?? humanize(ad[2])}`;
    }
    return `${group} · ${VARIANT_FIELDS[rest] ?? humanize(rest)}`;
  }
  // Longest known prefix ("settings.placements.facebookPositions.0" → "Facebook positions").
  const parts = clean.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('.');
    if (LABELS[prefix]) return LABELS[prefix]!;
  }
  return humanize(parts[parts.length - 1] ?? clean);
}

export interface FlatError {
  path: string;
  message: string;
}

/** Flattens react-hook-form errors into `{ path, message }` (root errors included). */
export function flattenErrors<T extends FieldValues>(errors: FieldErrors<T>, prefix = ''): FlatError[] {
  const out: FlatError[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message && typeof obj.type === 'string') {
      out.push({ path, message: obj.message });
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'ref' || key === 'message' || key === 'type' || key === 'types') continue;
      if (key === 'root') {
        const root = value as { message?: string } | undefined;
        if (root?.message && path) out.push({ path, message: root.message });
        continue;
      }
      walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(errors, prefix);
  return out;
}
