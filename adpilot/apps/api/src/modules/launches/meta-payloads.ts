import {
  goalRule,
  majorToMinor,
  targetsEu,
  type AdVariant,
  type LaunchConfig,
  type TemplateSettings,
  type Variant,
} from '@adpilot/shared';
import type { PlanRef } from './launch.types';

/**
 * Pure builders for Marketing API v26.0 request payloads. Kept free of I/O so they can be unit-tested and
 * reviewed in one place when the Graph API version is upgraded (see docs/META_API.md).
 *
 * Creation strategy (safety): the campaign is created PAUSED; ad sets and ads are created ACTIVE underneath
 * it, so nothing can deliver until the final ACTIVATING step flips the campaign to ACTIVE — and that step
 * only runs when every object was created successfully and the user asked for activation.
 */

export const ref = (key: string, field: PlanRef['field'] = 'metaId'): PlanRef => ({ $ref: key, field });

/** Creative enhancement features opted out when the user chooses "no automatic enhancements". */
export const ENHANCEMENT_OPT_OUT_FEATURES: Record<'IMAGE' | 'VIDEO' | 'CAROUSEL', string[]> = {
  IMAGE: [
    'image_touchups',
    'image_brightness_and_contrast',
    'image_templates',
    'image_uncrop',
    'image_animation',
    'text_optimizations',
    'enhance_cta',
    'adapt_to_placement',
    'description_automation',
    'add_text_overlay',
    'site_extensions',
    'inline_comment',
  ],
  VIDEO: ['video_auto_crop', 'text_optimizations', 'enhance_cta', 'adapt_to_placement', 'description_automation', 'site_extensions', 'inline_comment'],
  CAROUSEL: ['text_optimizations', 'enhance_cta', 'adapt_to_placement', 'description_automation', 'site_extensions', 'inline_comment'],
};

export function renderName(pattern: string, vars: Record<string, string | number>): string {
  return pattern
    .replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250);
}

export function effectiveCountries(settings: TemplateSettings, v: Variant): string[] {
  return v.countries.length ? v.countries : settings.targeting.countries;
}

export function buildCampaignPayload(config: LaunchConfig, name: string, currency: string): Record<string, unknown> {
  const s = config.settings;
  const allCountries = [...new Set(config.variants.flatMap((v) => effectiveCountries(s, v)))];
  const payload: Record<string, unknown> = {
    name,
    objective: s.objective,
    status: 'PAUSED',
    buying_type: 'AUCTION',
    special_ad_categories: s.specialAdCategories,
  };
  if (s.specialAdCategories.length) {
    payload.special_ad_category_country = s.specialAdCategoryCountries.length ? s.specialAdCategoryCountries : allCountries;
  }
  if (s.budget.level === 'CAMPAIGN') {
    const amount = majorToMinor(s.budget.amount, currency).toString();
    if (s.budget.type === 'DAILY') payload.daily_budget = amount;
    else payload.lifetime_budget = amount;
    payload.bid_strategy = s.budget.bidStrategy;
  } else {
    // Ad set budgets: the budget sharing flag must be set explicitly for campaigns without a campaign budget.
    payload.is_adset_budget_sharing_enabled = s.budget.budgetSharing;
  }
  if (s.budget.spendCap) payload.spend_cap = majorToMinor(s.budget.spendCap, currency).toString();
  return payload;
}

export function buildTargeting(s: TemplateSettings, v: Variant): Record<string, unknown> {
  const t = s.targeting;
  const genders = v.genders ?? t.genders;
  const locales = v.locales.length ? v.locales : t.locales;
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: effectiveCountries(s, v) },
    age_min: v.ageMin ?? t.ageMin,
    age_max: v.ageMax ?? t.ageMax,
    targeting_automation: { advantage_audience: t.advantageAudience ? 1 : 0 },
  };
  if (t.excludedCountries.length) targeting.excluded_geo_locations = { countries: t.excludedCountries };
  if (genders === 'MALE') targeting.genders = [1];
  if (genders === 'FEMALE') targeting.genders = [2];
  if (locales.length) targeting.locales = locales.map((l) => l.key);
  if (t.customAudienceIds.length) targeting.custom_audiences = t.customAudienceIds.map((id) => ({ id }));
  if (t.excludedCustomAudienceIds.length) targeting.excluded_custom_audiences = t.excludedCustomAudienceIds.map((id) => ({ id }));
  if (t.interests.length) targeting.flexible_spec = [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }];
  if (s.placements.mode === 'MANUAL') {
    const p = s.placements;
    targeting.publisher_platforms = p.publisherPlatforms;
    if (p.publisherPlatforms.includes('facebook') && p.facebookPositions.length) targeting.facebook_positions = p.facebookPositions;
    if (p.publisherPlatforms.includes('instagram') && p.instagramPositions.length) targeting.instagram_positions = p.instagramPositions;
    if (p.publisherPlatforms.includes('audience_network') && p.audienceNetworkPositions.length) targeting.audience_network_positions = p.audienceNetworkPositions;
    if (p.publisherPlatforms.includes('threads') && p.threadsPositions.length) targeting.threads_positions = p.threadsPositions;
    if (p.devicePlatforms.length) targeting.device_platforms = p.devicePlatforms;
  }
  return targeting;
}

export function buildAdSetPayload(
  config: LaunchConfig,
  v: Variant,
  name: string,
  currency: string,
  accountDefaults: { dsaBeneficiary?: string | null; dsaPayor?: string | null },
): Record<string, unknown> {
  const s = config.settings;
  const rule = goalRule(s.objective, s.destination, s.optimizationGoal);
  const payload: Record<string, unknown> = {
    name,
    campaign_id: ref('campaign'),
    status: 'ACTIVE',
    billing_event: s.billingEvent,
    optimization_goal: s.optimizationGoal,
    targeting: buildTargeting(s, v),
  };
  if (s.destination !== 'NONE') payload.destination_type = s.destination;
  if (rule?.promotedObject === 'PIXEL_EVENT') payload.promoted_object = { pixel_id: s.conversion.pixelId, custom_event_type: s.conversion.event };
  if (rule?.promotedObject === 'PAGE') payload.promoted_object = { page_id: s.identity.pageId };

  if (s.budget.level === 'ADSET') {
    const amount = majorToMinor(v.budgetAmount ?? s.budget.amount, currency).toString();
    if (s.budget.type === 'DAILY') payload.daily_budget = amount;
    else payload.lifetime_budget = amount;
    payload.bid_strategy = s.budget.bidStrategy;
  }
  if (s.budget.bidAmount && (s.budget.bidStrategy === 'COST_CAP' || s.budget.bidStrategy === 'LOWEST_COST_WITH_BID_CAP')) {
    payload.bid_amount = majorToMinor(s.budget.bidAmount, currency).toString();
  }
  if (s.budget.bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS' && s.budget.roasFloor) {
    payload.bid_constraints = { roas_average_floor: Math.round(Number(s.budget.roasFloor) * 10000) };
  }
  if (s.schedule.startTime) payload.start_time = s.schedule.startTime;
  if (s.schedule.endTime) payload.end_time = s.schedule.endTime;

  const conversionGoal = s.optimizationGoal === 'OFFSITE_CONVERSIONS' || s.optimizationGoal === 'VALUE';
  if (conversionGoal && s.attribution.mode === 'CUSTOM') {
    const spec: { event_type: string; window_days: number }[] = [{ event_type: 'CLICK_THROUGH', window_days: s.attribution.clickDays }];
    if (s.attribution.viewDays) spec.push({ event_type: 'VIEW_THROUGH', window_days: s.attribution.viewDays });
    if (s.attribution.engagedViewDays) spec.push({ event_type: 'ENGAGED_VIDEO_VIEW', window_days: s.attribution.engagedViewDays });
    payload.attribution_spec = spec;
  }
  if (targetsEu(effectiveCountries(s, v))) {
    payload.dsa_beneficiary = s.dsa.beneficiary || accountDefaults.dsaBeneficiary;
    payload.dsa_payor = s.dsa.payor || accountDefaults.dsaPayor;
  }
  return payload;
}

function callToAction(s: TemplateSettings, ad: AdVariant, link: string | undefined): Record<string, unknown> | undefined {
  const type = ad.callToAction ?? s.creative.callToAction;
  if (type === 'NO_BUTTON') return { type };
  const leadFormId = ad.leadFormId ?? s.creative.leadFormId;
  if (s.destination === 'ON_AD' && leadFormId) return { type, value: { lead_gen_form_id: leadFormId } };
  return link ? { type, value: { link } } : { type };
}

export interface CreativeRefs {
  /** Media plan item key for a creative file id. */
  mediaKey: (creativeFileId: string) => string;
  typeOf: (creativeFileId: string) => 'IMAGE' | 'VIDEO';
}

export function buildCreativePayload(config: LaunchConfig, v: Variant, ad: AdVariant, name: string, refs: CreativeRefs): Record<string, unknown> {
  const s = config.settings;
  const link = ad.link;
  const storySpec: Record<string, unknown> = { page_id: s.identity.pageId };
  if (s.identity.instagramUserId) storySpec.instagram_user_id = s.identity.instagramUserId;
  const displayLink = ad.displayLink ?? s.creative.displayLink;

  if (s.creative.format === 'SINGLE_VIDEO' && ad.creativeFileId) {
    const key = refs.mediaKey(ad.creativeFileId);
    storySpec.video_data = {
      video_id: ref(key, 'videoId'),
      image_url: ref(key, 'thumbnailUrl'),
      message: ad.primaryText,
      ...(ad.headline ? { title: ad.headline } : {}),
      ...(ad.description ? { link_description: ad.description } : {}),
      call_to_action: callToAction(s, ad, link),
    };
  } else if (s.creative.format === 'SINGLE_IMAGE' && ad.creativeFileId) {
    storySpec.link_data = {
      ...(link ? { link } : {}),
      message: ad.primaryText,
      ...(ad.headline ? { name: ad.headline } : {}),
      ...(ad.description ? { description: ad.description } : {}),
      ...(displayLink ? { caption: displayLink } : {}),
      image_hash: ref(refs.mediaKey(ad.creativeFileId), 'imageHash'),
      call_to_action: callToAction(s, ad, link),
    };
  } else {
    // Carousel (2-10 cards, image or video cards).
    storySpec.link_data = {
      link: link ?? ad.cards[0]?.link,
      message: ad.primaryText,
      ...(displayLink ? { caption: displayLink } : {}),
      multi_share_optimized: true,
      multi_share_end_card: false,
      child_attachments: ad.cards.map((c) => {
        const key = refs.mediaKey(c.creativeFileId);
        const cardLink = c.link ?? link;
        const media =
          refs.typeOf(c.creativeFileId) === 'VIDEO'
            ? { video_id: ref(key, 'videoId'), picture: ref(key, 'thumbnailUrl') }
            : { image_hash: ref(key, 'imageHash') };
        return {
          link: cardLink,
          ...(c.headline ? { name: c.headline } : {}),
          ...(c.description ? { description: c.description } : {}),
          ...media,
          call_to_action: callToAction(s, ad, cardLink),
        };
      }),
      call_to_action: callToAction(s, ad, link ?? ad.cards[0]?.link),
    };
  }

  const payload: Record<string, unknown> = { name, object_story_spec: storySpec };
  const urlTags = ad.urlParameters ?? s.creative.urlParameters;
  if (urlTags) payload.url_tags = urlTags;
  payload.contextual_multi_ads = { enroll_status: s.creative.multiAdvertiserAds ? 'OPT_IN' : 'OPT_OUT' };
  if (s.creative.enhancements === 'OFF') {
    const kind = s.creative.format === 'CAROUSEL' ? 'CAROUSEL' : s.creative.format === 'SINGLE_VIDEO' ? 'VIDEO' : 'IMAGE';
    payload.degrees_of_freedom_spec = {
      creative_features_spec: Object.fromEntries(ENHANCEMENT_OPT_OUT_FEATURES[kind].map((f) => [f, { enroll_status: 'OPT_OUT' }])),
    };
  }
  void v;
  return payload;
}

export function buildAdPayload(name: string, adSetKey: string, creativeKey: string): Record<string, unknown> {
  return {
    name,
    adset_id: ref(adSetKey),
    creative: { creative_id: ref(creativeKey) },
    status: 'ACTIVE',
  };
}

/** Replaces every PlanRef in a payload using the resolver. Throws when a reference is not available yet. */
export function resolveRefs(value: unknown, resolve: (r: PlanRef) => string | null): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, resolve));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$ref === 'string' && typeof obj.field === 'string') {
      const resolved = resolve(obj as unknown as PlanRef);
      if (resolved === null) throw new Error(`Unresolved reference ${obj.$ref}.${obj.field}`);
      return resolved;
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveRefs(v, resolve)]));
  }
  return value;
}
