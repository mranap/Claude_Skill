import { z } from 'zod';
import {
  BID_STRATEGIES,
  BILLING_EVENTS,
  CALL_TO_ACTIONS,
  CONVERSION_EVENTS,
  DESTINATIONS,
  OBJECTIVES,
  OPTIMIZATION_GOALS,
  SPECIAL_AD_CATEGORIES,
} from '../meta/objectives';
import {
  AUDIENCE_NETWORK_POSITIONS,
  DEVICE_PLATFORMS,
  FACEBOOK_POSITIONS,
  INSTAGRAM_POSITIONS,
  PUBLISHER_PLATFORMS,
  THREADS_POSITIONS,
  placementIssues,
} from '../meta/placements';
import { COUNTRY_CODES } from '../meta/countries';
import { moneyStringSchema, paginationQuerySchema } from './common';

/**
 * Campaign templates and launch configurations.
 *
 *   Template  = reusable Campaign + Ad Set settings (+ optional predefined language/geo groups)
 *   Launch    = template settings (possibly overridden) + language/geo groups ("variants"), each producing
 *               one ad set with one or more ads.
 *
 * Money is entered in major units ("25.50") and converted to the ad account currency's minor units only
 * when the Meta payload is built (see money.ts).
 */

export const metaIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,30}$/, 'Invalid Meta id');
const countrySchema = z.string().refine((c) => COUNTRY_CODES.includes(c), 'Unknown country code');
const httpsUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url('Enter a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), 'The URL must start with https://');

export const localeSchema = z.object({ key: z.number().int().positive(), name: z.string().trim().max(100) });
export const interestSchema = z.object({ id: metaIdSchema, name: z.string().trim().max(200) });

export const GENDERS = ['ALL', 'MALE', 'FEMALE'] as const;

export const targetingSchema = z
  .object({
    /** Default countries; a language/geo group can override them. */
    countries: z.array(countrySchema).max(250).default([]),
    excludedCountries: z.array(countrySchema).max(250).default([]),
    ageMin: z.number().int().min(13).max(65).default(18),
    /** 65 means "65+". */
    ageMax: z.number().int().min(13).max(65).default(65),
    genders: z.enum(GENDERS).default('ALL'),
    locales: z.array(localeSchema).max(50).default([]),
    /** Advantage+ audience (targeting_automation.advantage_audience = 1). */
    advantageAudience: z.boolean().default(false),
    customAudienceIds: z.array(metaIdSchema).max(100).default([]),
    excludedCustomAudienceIds: z.array(metaIdSchema).max(100).default([]),
    interests: z.array(interestSchema).max(200).default([]),
  })
  .superRefine((t, ctx) => {
    if (t.ageMin > t.ageMax)
      ctx.addIssue({ code: 'custom', path: ['ageMin'], message: 'Minimum age is greater than maximum age' });
    // Advantage+ audience (Meta targeting reference): age_min may only be 18–25 and age_max is fixed at 65.
    if (t.advantageAudience) {
      if (t.ageMin < 18 || t.ageMin > 25)
        ctx.addIssue({
          code: 'custom',
          path: ['ageMin'],
          message: 'With Advantage+ audience the minimum age must be between 18 and 25',
        });
      if (t.ageMax !== 65)
        ctx.addIssue({
          code: 'custom',
          path: ['ageMax'],
          message: 'With Advantage+ audience the maximum age is always 65+',
        });
    }
  });

/** Stored configurations may still list Messenger, which Meta no longer offers; it is dropped on read. */
const publisherPlatformsSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((p) => p !== 'messenger') : v),
  z.array(z.enum(PUBLISHER_PLATFORMS)).min(1, 'Select at least one platform'),
);

export const placementsSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('AUTOMATIC') }),
    z.object({
      mode: z.literal('MANUAL'),
      publisherPlatforms: publisherPlatformsSchema,
      facebookPositions: z.array(z.enum(FACEBOOK_POSITIONS)).default([]),
      instagramPositions: z.array(z.enum(INSTAGRAM_POSITIONS)).default([]),
      audienceNetworkPositions: z.array(z.enum(AUDIENCE_NETWORK_POSITIONS)).default([]),
      threadsPositions: z.array(z.enum(THREADS_POSITIONS)).default([]),
      devicePlatforms: z.array(z.enum(DEVICE_PLATFORMS)).default([]),
    }),
  ])
  .superRefine((p, ctx) => {
    if (p.mode !== 'MANUAL') return;
    for (const issue of placementIssues(p)) {
      if (issue.severity === 'error')
        ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
  });

export const budgetSchema = z.object({
  /** CAMPAIGN = Advantage campaign budget (budget on the campaign), ADSET = budget per ad set. */
  level: z.enum(['CAMPAIGN', 'ADSET']).default('ADSET'),
  type: z.enum(['DAILY', 'LIFETIME']).default('DAILY'),
  /** Campaign budget (CAMPAIGN level) or default budget of every ad set (ADSET level). */
  amount: moneyStringSchema,
  bidStrategy: z.enum(BID_STRATEGIES).default('LOWEST_COST_WITHOUT_CAP'),
  /** Cost per result goal / bid cap, in major units. */
  bidAmount: moneyStringSchema.optional(),
  /** Minimum ROAS, e.g. "1.5" = 150 %. Meta accepts 0.01–1000 (sent ×10 000 as roas_average_floor). */
  roasFloor: z
    .string()
    .trim()
    .regex(/^\d{1,4}(\.\d{1,4})?$/)
    .refine((v) => Number(v) >= 0.01 && Number(v) <= 1000, 'The minimum ROAS must be between 0.01 and 1000')
    .optional(),
  /** Ad set budget sharing (is_adset_budget_sharing_enabled) — ADSET level only. */
  budgetSharing: z.boolean().default(false),
  /** Optional campaign spend cap in major units. */
  spendCap: moneyStringSchema.optional(),
});

export const scheduleSchema = z.object({
  /** ISO datetime; empty = start immediately. */
  startTime: z.iso.datetime({ offset: true }).optional(),
  /** Required for lifetime budgets. */
  endTime: z.iso.datetime({ offset: true }).optional(),
});

export const conversionSchema = z.object({
  pixelId: metaIdSchema.optional(),
  event: z.enum(CONVERSION_EVENTS).optional(),
});

export const identitySchema = z.object({
  pageId: metaIdSchema,
  /** Instagram account id; empty = Meta uses the Page for Instagram placements. */
  instagramUserId: metaIdSchema.optional(),
});

/**
 * Ad set attribution (attribution_spec). Meta accepts click-through 1 or 7 days and view-through 1 day;
 * ENGAGED_VIDEO_VIEW (shown as "engage-through" in Ads Manager since March 2026) 1 day. DEFAULT sends no
 * attribution_spec; CUSTOM starts from the current Ads Manager default (7-day click, 1-day engage-through,
 * 1-day view). Longer view windows were removed by Meta.
 */
export const attributionSchema = z.object({
  mode: z.enum(['DEFAULT', 'CUSTOM']).default('DEFAULT'),
  clickDays: z.union([z.literal(1), z.literal(7)]).default(7),
  viewDays: z.union([z.literal(0), z.literal(1)]).default(1),
  engagedViewDays: z.union([z.literal(0), z.literal(1)]).default(1),
});

export const dsaSchema = z.object({
  beneficiary: z.string().trim().max(200).optional(),
  payor: z.string().trim().max(200).optional(),
});

export const AD_FORMATS = ['SINGLE_IMAGE', 'SINGLE_VIDEO', 'CAROUSEL'] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

export const creativeOptionsSchema = z.object({
  format: z.enum(AD_FORMATS).default('SINGLE_VIDEO'),
  callToAction: z.enum(CALL_TO_ACTIONS).default('LEARN_MORE'),
  /** Appended to every link (url_tags), e.g. utm_source=facebook&utm_campaign={{campaign.name}}. */
  urlParameters: z.string().trim().max(1000).optional(),
  displayLink: z.string().trim().max(100).optional(),
  /** Instant Form id for lead ads (destination "Instant form"). */
  leadFormId: metaIdSchema.optional(),
  /**
   * Advantage+ creative enhancements: OFF = opt out of every automatic enhancement (ads look exactly as
   * uploaded), META_DEFAULT = let Meta apply its default enhancements.
   */
  enhancements: z.enum(['OFF', 'META_DEFAULT']).default('OFF'),
  /** Multi-advertiser ads (contextual_multi_ads). */
  multiAdvertiserAds: z.boolean().default(false),
});

export const namingSchema = z.object({
  campaign: z.string().trim().min(1).max(200).default('{name} | {date} | #{code}'),
  adSet: z.string().trim().min(1).max(200).default('{name} | {variant} | {countries}'),
  ad: z.string().trim().min(1).max(200).default('{variant} | {creative} | {n}'),
});

export const templateSettingsSchema = z.object({
  objective: z.enum(OBJECTIVES),
  destination: z.enum(DESTINATIONS),
  optimizationGoal: z.enum(OPTIMIZATION_GOALS),
  billingEvent: z.enum(BILLING_EVENTS).default('IMPRESSIONS'),
  specialAdCategories: z.array(z.enum(SPECIAL_AD_CATEGORIES)).max(5).default([]),
  specialAdCategoryCountries: z.array(countrySchema).max(250).default([]),
  budget: budgetSchema,
  schedule: scheduleSchema.default({}),
  targeting: targetingSchema.default(targetingSchema.parse({})),
  placements: placementsSchema.default({ mode: 'AUTOMATIC' }),
  conversion: conversionSchema.default({}),
  identity: identitySchema.partial().default({}),
  attribution: attributionSchema.default(attributionSchema.parse({})),
  dsa: dsaSchema.default({}),
  creative: creativeOptionsSchema.default(creativeOptionsSchema.parse({})),
  naming: namingSchema.default(namingSchema.parse({})),
  /** Status after successful creation: everything is created PAUSED and activated only at the end. */
  activateOnSuccess: z.boolean().default(false),
});
export type TemplateSettings = z.infer<typeof templateSettingsSchema>;

export const carouselCardSchema = z.object({
  creativeFileId: z.uuid(),
  headline: z.string().trim().max(255).optional(),
  description: z.string().trim().max(255).optional(),
  link: httpsUrlSchema.optional(),
});

export const adVariantSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().max(150).optional(),
  /** Single image / single video ads. */
  creativeFileId: z.uuid().optional(),
  /** Carousel ads (2-10 cards). */
  cards: z.array(carouselCardSchema).max(10).default([]),
  primaryText: z.string().trim().min(1, 'Primary text is required').max(2200),
  headline: z.string().trim().max(255).optional(),
  description: z.string().trim().max(255).optional(),
  link: httpsUrlSchema.optional(),
  callToAction: z.enum(CALL_TO_ACTIONS).optional(),
  urlParameters: z.string().trim().max(1000).optional(),
  displayLink: z.string().trim().max(100).optional(),
  leadFormId: metaIdSchema.optional(),
});
export type AdVariant = z.infer<typeof adVariantSchema>;

/** A language/geo group: one ad set with its own countries/languages and ads. */
export const variantSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  label: z.string().trim().min(1).max(60),
  countries: z.array(countrySchema).max(250).default([]),
  locales: z.array(localeSchema).max(50).default([]),
  budgetAmount: moneyStringSchema.optional(),
  ageMin: z.number().int().min(13).max(65).optional(),
  ageMax: z.number().int().min(13).max(65).optional(),
  genders: z.enum(GENDERS).optional(),
  ads: z.array(adVariantSchema).max(50).default([]),
});
export type Variant = z.infer<typeof variantSchema>;

export const templateConfigSchema = z.object({
  version: z.literal(1).default(1),
  settings: templateSettingsSchema,
  variants: z.array(variantSchema).max(50).default([]),
});
export type TemplateConfig = z.infer<typeof templateConfigSchema>;

export const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  config: templateConfigSchema,
});

export const templateUpdateSchema = templateCreateSchema
  .partial()
  .extend({ isArchived: z.boolean().optional() });

export const templateListQuerySchema = paginationQuerySchema.extend({
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  objective: z.enum(OBJECTIVES).optional(),
});

/** Full launch configuration (validated strictly before a launch). */
export const launchConfigSchema = z.object({
  version: z.literal(1).default(1),
  profileId: z.uuid(),
  adAccountId: z.uuid(),
  templateId: z.uuid().optional(),
  name: z.string().trim().min(1).max(150),
  settings: templateSettingsSchema,
  variants: z.array(variantSchema).min(1, 'Add at least one language/geo group').max(50),
});
export type LaunchConfig = z.infer<typeof launchConfigSchema>;

/** Drafts are saved step by step, so any subset of the launch configuration is accepted. */
export const draftSaveSchema = z.object({
  name: z.string().trim().min(1).max(150),
  templateId: z.uuid().nullable().optional(),
  profileId: z.uuid().nullable().optional(),
  adAccountId: z.uuid().nullable().optional(),
  config: z.record(z.string(), z.unknown()),
});

export const launchRequestSchema = z.object({
  /** Client-generated key (one per "Launch" screen) — repeated submissions return the same job. */
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  draftId: z.uuid().optional(),
  config: launchConfigSchema,
});
