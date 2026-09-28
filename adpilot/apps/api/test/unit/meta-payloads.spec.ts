import { describe, expect, it } from 'vitest';
import { launchConfigSchema, type LaunchConfig } from '@adpilot/shared';
import {
  buildAdPayload,
  buildAdSetPayload,
  buildCampaignPayload,
  buildCreativePayload,
  buildTargeting,
  ENHANCEMENT_OPT_OUT_FEATURES,
  renderName,
  resolveRefs,
} from '../../src/modules/launches/meta-payloads';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const IMAGE = '22222222-2222-4222-8222-222222222222';

function config(overrides: Record<string, unknown> = {}, variants?: unknown[]): LaunchConfig {
  return launchConfigSchema.parse({
    profileId: '33333333-3333-4333-8333-333333333333',
    adAccountId: '44444444-4444-4444-8444-444444444444',
    name: 'Spring launch',
    settings: {
      objective: 'OUTCOME_LEADS',
      destination: 'WEBSITE',
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      budget: { level: 'ADSET', type: 'DAILY', amount: '25.50' },
      conversion: { pixelId: '555', event: 'LEAD' },
      identity: { pageId: '666' },
      targeting: { countries: ['US'] },
      ...overrides,
    },
    variants: variants ?? [
      {
        key: 'en',
        label: 'EN',
        countries: ['US', 'CA'],
        ads: [{ key: 'a1', creativeFileId: VIDEO, primaryText: 'Hello', headline: 'Title', link: 'https://example.com/lp' }],
      },
    ],
  });
}

const refs = { mediaKey: (id: string) => `media:${id}`, typeOf: (id: string) => (id === VIDEO ? ('VIDEO' as const) : ('IMAGE' as const)) };

describe('campaign payload', () => {
  it('creates the campaign PAUSED with explicit ad set budget sharing flag for ad set budgets', () => {
    const p = buildCampaignPayload(config(), 'Camp', 'USD');
    expect(p).toMatchObject({ name: 'Camp', objective: 'OUTCOME_LEADS', status: 'PAUSED', buying_type: 'AUCTION', special_ad_categories: [] });
    expect(p.is_adset_budget_sharing_enabled).toBe(false);
    expect(p.daily_budget).toBeUndefined();
    expect(p.special_ad_category_country).toBeUndefined();
  });

  it('puts the budget on the campaign (minor units as string) for campaign budgets', () => {
    const p = buildCampaignPayload(
      config({ budget: { level: 'CAMPAIGN', type: 'LIFETIME', amount: '1500', bidStrategy: 'COST_CAP', bidAmount: '3' } }),
      'Camp',
      'JPY',
    );
    expect(p.lifetime_budget).toBe('1500');
    expect(p.bid_strategy).toBe('COST_CAP');
    expect(p.is_adset_budget_sharing_enabled).toBeUndefined();
  });

  it('defaults special_ad_category_country to all targeted countries', () => {
    const p = buildCampaignPayload(config({ specialAdCategories: ['EMPLOYMENT'] }), 'Camp', 'USD');
    expect(p.special_ad_categories).toEqual(['EMPLOYMENT']);
    expect(p.special_ad_category_country).toEqual(['US', 'CA']);
  });
});

describe('ad set payload', () => {
  it('references the campaign, sets promoted_object for pixel conversions and converts the budget', () => {
    const c = config();
    const p = buildAdSetPayload(c, c.variants[0], 'AdSet', 'USD', {});
    expect(p.campaign_id).toEqual({ $ref: 'campaign', field: 'metaId' });
    expect(p).toMatchObject({
      status: 'ACTIVE',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      billing_event: 'IMPRESSIONS',
      destination_type: 'WEBSITE',
      promoted_object: { pixel_id: '555', custom_event_type: 'LEAD' },
      daily_budget: '2550',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    });
    expect(p.dsa_beneficiary).toBeUndefined();
    expect(p.attribution_spec).toBeUndefined();
  });

  it('adds DSA beneficiary/payor for EU targeting, falling back to the ad account defaults', () => {
    const c = config({}, [{ key: 'de', label: 'DE', countries: ['DE'], ads: [{ key: 'a', creativeFileId: VIDEO, primaryText: 'x', link: 'https://e.com' }] }]);
    const p = buildAdSetPayload(c, c.variants[0], 'AdSet', 'EUR', { dsaBeneficiary: 'Acme GmbH', dsaPayor: 'Acme GmbH' });
    expect(p.dsa_beneficiary).toBe('Acme GmbH');
    expect(p.dsa_payor).toBe('Acme GmbH');
  });

  it('uses the variant budget override and ROAS floor scaled by 10 000', () => {
    const c = config(
      {
        objective: 'OUTCOME_SALES',
        optimizationGoal: 'VALUE',
        conversion: { pixelId: '555', event: 'PURCHASE' },
        budget: { level: 'ADSET', type: 'DAILY', amount: '10', bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS', roasFloor: '1.5' },
        attribution: { mode: 'CUSTOM', clickDays: 1, viewDays: 0, engagedViewDays: 0 },
      },
      [{ key: 'v', label: 'V', countries: ['US'], budgetAmount: '40', ads: [{ key: 'a', creativeFileId: IMAGE, primaryText: 'x', link: 'https://e.com' }] }],
    );
    const p = buildAdSetPayload(c, c.variants[0], 'AdSet', 'USD', {});
    expect(p.daily_budget).toBe('4000');
    expect(p.bid_constraints).toEqual({ roas_average_floor: 15000 });
    expect(p.attribution_spec).toEqual([{ event_type: 'CLICK_THROUGH', window_days: 1 }]);
  });

  it('builds targeting with an explicit Advantage+ audience flag, genders, locales and manual placements', () => {
    const c = config({
      targeting: { countries: ['US'], genders: 'FEMALE', ageMin: 25, ageMax: 54, locales: [{ key: 6, name: 'English (US)' }], advantageAudience: false },
      placements: {
        mode: 'MANUAL',
        publisherPlatforms: ['facebook', 'instagram'],
        facebookPositions: ['feed'],
        instagramPositions: ['stream', 'story'],
        audienceNetworkPositions: ['classic'],
        devicePlatforms: ['mobile'],
      },
    });
    const t = buildTargeting(c.settings, c.variants[0]);
    expect(t).toMatchObject({
      geo_locations: { countries: ['US', 'CA'] },
      age_min: 25,
      age_max: 54,
      genders: [2],
      locales: [6],
      targeting_automation: { advantage_audience: 0 },
      publisher_platforms: ['facebook', 'instagram'],
      facebook_positions: ['feed'],
      instagram_positions: ['stream', 'story'],
      device_platforms: ['mobile'],
    });
    // Positions of platforms that are not selected are never sent.
    expect(t.audience_network_positions).toBeUndefined();
  });
});

describe('creative and ad payloads', () => {
  it('video creative references the uploaded video and its thumbnail, opts out of enhancements', () => {
    const c = config();
    const ad = c.variants[0].ads[0];
    const p = buildCreativePayload(c, c.variants[0], ad, 'Creative', refs) as any;
    expect(p.object_story_spec.page_id).toBe('666');
    expect(p.object_story_spec.video_data).toMatchObject({
      video_id: { $ref: `media:${VIDEO}`, field: 'videoId' },
      image_url: { $ref: `media:${VIDEO}`, field: 'thumbnailUrl' },
      message: 'Hello',
      title: 'Title',
      call_to_action: { type: 'LEARN_MORE', value: { link: 'https://example.com/lp' } },
    });
    expect(p.contextual_multi_ads).toEqual({ enroll_status: 'OPT_OUT' });
    const features = p.degrees_of_freedom_spec.creative_features_spec;
    expect(Object.keys(features).sort()).toEqual([...ENHANCEMENT_OPT_OUT_FEATURES.VIDEO].sort());
    expect(Object.values(features).every((f: any) => f.enroll_status === 'OPT_OUT')).toBe(true);
  });

  it('image creative uses the image hash and Meta default enhancements send no opt-out spec', () => {
    const c = config({ creative: { format: 'SINGLE_IMAGE', enhancements: 'META_DEFAULT', urlParameters: 'utm_source=fb' } }, [
      { key: 'v', label: 'V', countries: ['US'], ads: [{ key: 'a', creativeFileId: IMAGE, primaryText: 'Buy', link: 'https://e.com' }] },
    ]);
    const p = buildCreativePayload(c, c.variants[0], c.variants[0].ads[0], 'Creative', refs) as any;
    expect(p.object_story_spec.link_data).toMatchObject({ link: 'https://e.com', image_hash: { $ref: `media:${IMAGE}`, field: 'imageHash' } });
    expect(p.url_tags).toBe('utm_source=fb');
    expect(p.degrees_of_freedom_spec).toBeUndefined();
  });

  it('carousel creative builds one child attachment per card (video cards get a picture)', () => {
    const c = config({ creative: { format: 'CAROUSEL' } }, [
      {
        key: 'v',
        label: 'V',
        countries: ['US'],
        ads: [
          {
            key: 'a',
            primaryText: 'Cards',
            link: 'https://e.com',
            cards: [
              { creativeFileId: IMAGE, headline: 'One' },
              { creativeFileId: VIDEO, headline: 'Two', link: 'https://e.com/2' },
            ],
          },
        ],
      },
    ]);
    const p = buildCreativePayload(c, c.variants[0], c.variants[0].ads[0], 'Creative', refs) as any;
    const cards = p.object_story_spec.link_data.child_attachments;
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ link: 'https://e.com', name: 'One', image_hash: { field: 'imageHash' } });
    expect(cards[1]).toMatchObject({ link: 'https://e.com/2', video_id: { field: 'videoId' }, picture: { field: 'thumbnailUrl' } });
  });

  it('lead form CTA uses lead_gen_form_id', () => {
    const c = config(
      { destination: 'ON_AD', optimizationGoal: 'LEAD_GENERATION', creative: { format: 'SINGLE_VIDEO', callToAction: 'SIGN_UP', leadFormId: '999' } },
      [{ key: 'v', label: 'V', countries: ['US'], ads: [{ key: 'a', creativeFileId: VIDEO, primaryText: 'x' }] }],
    );
    const p = buildCreativePayload(c, c.variants[0], c.variants[0].ads[0], 'Creative', refs) as any;
    expect(p.object_story_spec.video_data.call_to_action).toEqual({ type: 'SIGN_UP', value: { lead_gen_form_id: '999' } });
  });

  it('ad payload links ad set and creative references', () => {
    expect(buildAdPayload('Ad', 'adset:v', 'creative:v:a')).toEqual({
      name: 'Ad',
      adset_id: { $ref: 'adset:v', field: 'metaId' },
      creative: { creative_id: { $ref: 'creative:v:a', field: 'metaId' } },
      status: 'ACTIVE',
    });
  });
});

describe('helpers', () => {
  it('resolves references deeply and fails loudly on missing ones', () => {
    const payload = { a: { $ref: 'x', field: 'metaId' }, list: [{ b: { $ref: 'y', field: 'videoId' } }], n: 1 };
    const resolved = resolveRefs(payload, (r) => (r.$ref === 'x' ? '123' : r.$ref === 'y' ? '456' : null));
    expect(resolved).toEqual({ a: '123', list: [{ b: '456' }], n: 1 });
    expect(() => resolveRefs({ a: { $ref: 'z', field: 'metaId' } }, () => null)).toThrow(/Unresolved reference z/);
  });

  it('renders naming patterns and keeps unknown placeholders', () => {
    expect(renderName('{name} | {date} | #{code}', { name: 'Spring', date: '2026-09-28', code: 'AB12' })).toBe('Spring | 2026-09-28 | #AB12');
    expect(renderName('{name}  {unknown}', { name: 'X' })).toBe('X {unknown}');
    expect(renderName('x'.repeat(400), {})).toHaveLength(250);
  });
});
