import { describe, expect, it } from 'vitest';
import { budgetSchema, placementIssues, placementsSchema, targetingSchema } from '@adpilot/shared';
import { classifyGraphError, MetaApiError } from '../../src/modules/meta/graph/meta-errors';
import {
  computeResults,
  extractConversions,
  isTooMuchData,
  metaResults,
  resultTypeFromIndicator,
} from '../../src/modules/statistics/insights-sync.service';

const manual = (p: Partial<Parameters<typeof placementIssues>[0]>) => ({
  publisherPlatforms: [],
  facebookPositions: [],
  instagramPositions: [],
  audienceNetworkPositions: [],
  threadsPositions: [],
  devicePlatforms: [],
  ...p,
});
const errors = (p: Partial<Parameters<typeof placementIssues>[0]>) =>
  placementIssues(manual(p))
    .filter((i) => i.severity === 'error')
    .map((i) => i.message);

describe('placement rules (Meta placement targeting limitations)', () => {
  it('Messenger is no longer offered; stored configurations are cleaned on read', () => {
    const parsed = placementsSchema.parse({
      mode: 'MANUAL',
      publisherPlatforms: ['facebook', 'messenger'],
      facebookPositions: ['feed'],
    });
    expect(parsed.mode === 'MANUAL' && parsed.publisherPlatforms).toEqual(['facebook']);
    expect(placementsSchema.safeParse({ mode: 'MANUAL', publisherPlatforms: ['messenger'] }).success).toBe(
      false,
    );
  });

  it('rejects impossible combinations', () => {
    expect(errors({ publisherPlatforms: ['audience_network'] })).toHaveLength(1);
    expect(errors({ publisherPlatforms: ['threads', 'facebook'] })[0]).toMatch(/Instagram feed/);
    expect(
      errors({ publisherPlatforms: ['threads', 'instagram'], instagramPositions: ['story'] })[0],
    ).toMatch(/Instagram feed/);
    expect(errors({ publisherPlatforms: ['facebook'], facebookPositions: ['story'] })[0]).toMatch(/Stories/);
    expect(
      errors({
        publisherPlatforms: ['facebook'],
        facebookPositions: ['story', 'feed'],
        devicePlatforms: ['desktop'],
      })[0],
    ).toMatch(/mobile/);
    expect(errors({ publisherPlatforms: ['facebook'], facebookPositions: ['marketplace'] })[0]).toMatch(
      /Facebook Feed/,
    );
    expect(errors({ publisherPlatforms: ['instagram'], devicePlatforms: ['desktop'] })[0]).toMatch(/desktop/);
  });

  it('accepts valid combinations', () => {
    expect(errors({ publisherPlatforms: ['facebook', 'instagram'] })).toEqual([]);
    expect(
      errors({ publisherPlatforms: ['instagram', 'threads'], instagramPositions: ['stream', 'story'] }),
    ).toEqual([]);
    expect(
      errors({
        publisherPlatforms: ['facebook', 'audience_network'],
        facebookPositions: ['feed', 'marketplace', 'story'],
      }),
    ).toEqual([]);
    expect(
      placementsSchema.safeParse({
        mode: 'MANUAL',
        publisherPlatforms: ['facebook'],
        facebookPositions: ['marketplace'],
      }).success,
    ).toBe(false);
  });
});

describe('Advantage+ audience and bidding rules', () => {
  it('Advantage+ audience: minimum age 18–25, maximum age fixed at 65', () => {
    expect(targetingSchema.safeParse({ advantageAudience: true, ageMin: 21, ageMax: 65 }).success).toBe(true);
    expect(targetingSchema.safeParse({ advantageAudience: true, ageMin: 30, ageMax: 65 }).success).toBe(
      false,
    );
    expect(targetingSchema.safeParse({ advantageAudience: true, ageMin: 18, ageMax: 45 }).success).toBe(
      false,
    );
    expect(targetingSchema.safeParse({ advantageAudience: false, ageMin: 30, ageMax: 45 }).success).toBe(
      true,
    );
    expect(targetingSchema.safeParse({ ageMin: 50, ageMax: 30 }).success).toBe(false);
  });

  it('minimum ROAS must be within Meta’s 0.01–1000 range', () => {
    const base = { amount: '10', bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS' };
    expect(budgetSchema.safeParse({ ...base, roasFloor: '1.5' }).success).toBe(true);
    expect(budgetSchema.safeParse({ ...base, roasFloor: '0.001' }).success).toBe(false);
    expect(budgetSchema.safeParse({ ...base, roasFloor: '1001' }).success).toBe(false);
  });
});

describe('Insights results and errors', () => {
  const row = {
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    objective: 'OUTCOME_LEADS',
  };

  it("prefers Meta's own results (e.g. a registration event) and never sums attribution windows", () => {
    const r = {
      ...row,
      actions: [{ action_type: 'lead', value: '9' }],
      results: [
        {
          indicator: 'actions:offsite_conversion.fb_pixel_complete_registration',
          values: [
            { value: '4', attribution_windows: ['default'] },
            { value: '6', attribution_windows: ['7d_click'] },
          ],
        },
      ],
    };
    expect(computeResults(r, extractConversions(r))).toEqual({ value: '4', type: 'complete_registration' });
    expect(
      metaResults({ ...row, results: [{ indicator: 'actions:link_click', values: [{ value: 'n/a' }] }] }),
    ).toBeNull();
    expect(
      computeResults(
        { ...row, actions: [{ action_type: 'lead', value: '9' }] },
        extractConversions({ ...row, actions: [{ action_type: 'lead', value: '9' }] }),
      ),
    ).toEqual({ value: '9', type: 'leads' });
  });

  it('maps result indicators to friendly types', () => {
    expect(resultTypeFromIndicator('actions:onsite_conversion.lead_grouped')).toBe('leads');
    expect(resultTypeFromIndicator('actions:omni_purchase')).toBe('purchases');
    expect(resultTypeFromIndicator('video_thruplay_watched_actions:video_view')).toBe('thruplays');
    expect(resultTypeFromIndicator('actions:link_click')).toBe('link_clicks');
  });

  it('detects the documented "too much data" errors only', () => {
    const e = (code: number, subcode?: number, message = 'x') =>
      new MetaApiError(classifyGraphError({ code, error_subcode: subcode, message }, 400));
    expect(isTooMuchData(e(100, 1487534))).toBe(true);
    expect(isTooMuchData(e(100, 1504018))).toBe(true);
    expect(isTooMuchData(e(2, 1504038))).toBe(true);
    expect(
      isTooMuchData(
        e(1, undefined, "Please reduce the amount of data you're asking for, then retry your request"),
      ),
    ).toBe(true);
    expect(isTooMuchData(e(1, undefined, 'An unknown error occurred'))).toBe(false);
    expect(isTooMuchData(new Error('x'))).toBe(false);
  });
});
