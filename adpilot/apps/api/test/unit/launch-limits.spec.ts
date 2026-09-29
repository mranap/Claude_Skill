import { describe, expect, it } from 'vitest';
import {
  adSetDailyMinimum,
  lifetimeMinimum,
  type AdSetMinimumInput,
} from '../../src/modules/launches/budget-rules';
import { inFlightAmbiguityMs } from '../../src/modules/launches/launch-executor.service';
import { MetaMediaService } from '../../src/modules/creatives/meta-media.service';
import { classifyGraphError, MetaApiError } from '../../src/modules/meta/graph/meta-errors';

const DAY = 86_400_000;

describe('Meta budget minimums (Ad Set reference, "Bid/Budget Validations")', () => {
  const base: AdSetMinimumInput = {
    accountMinDaily: 100n,
    billingEvent: 'IMPRESSIONS',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    bidAmount: null,
  };

  it('impression billing needs the account minimum, click and ThruPlay billing five times as much', () => {
    expect(adSetDailyMinimum(base)).toMatchObject({ daily: 100n, basis: 'the ad account minimum' });
    expect(adSetDailyMinimum({ ...base, billingEvent: 'LINK_CLICKS' })?.daily).toBe(500n);
    expect(adSetDailyMinimum({ ...base, billingEvent: 'THRUPLAY' })?.daily).toBe(500n);
    expect(adSetDailyMinimum({ ...base, accountMinDaily: null })).toBeNull();
  });

  it('a bid cap needs at least the bid (impressions) or five times the bid (clicks and actions)', () => {
    const bidCap: AdSetMinimumInput = { ...base, bidStrategy: 'LOWEST_COST_WITH_BID_CAP' };
    expect(adSetDailyMinimum({ ...bidCap, bidAmount: 1000n })).toMatchObject({
      daily: 1000n,
      basis: 'the bid cap',
    });
    expect(adSetDailyMinimum({ ...bidCap, billingEvent: 'LINK_CLICKS', bidAmount: 500n })?.daily).toBe(2500n);
    expect(
      adSetDailyMinimum({ ...bidCap, billingEvent: 'THRUPLAY', accountMinDaily: null, bidAmount: 30n })
        ?.daily,
    ).toBe(150n);
    // The account minimum still applies below a small bid.
    expect(adSetDailyMinimum({ ...bidCap, bidAmount: 10n })?.daily).toBe(100n);
    // Meta documents no other multiplier: cost-per-result goals only need the account minimum.
    expect(
      adSetDailyMinimum({ ...base, bidStrategy: 'COST_CAP', billingEvent: 'LINK_CLICKS', bidAmount: 500n })
        ?.daily,
    ).toBe(100n);
  });

  it('a lifetime budget covers the daily minimum over the scheduled duration', () => {
    expect(lifetimeMinimum(500n, 0, 5 * DAY)).toBe(2500n); // "a campaign lasting 5 days will need at least $25"
    expect(lifetimeMinimum(100n, 0, 1.5 * DAY)).toBe(150n);
    expect(lifetimeMinimum(100n, 0, DAY + 1)).toBe(101n); // rounded up to the minor unit
    expect(lifetimeMinimum(100n, DAY, 0)).toBe(0n);
  });
});

describe('launch ambiguity window', () => {
  it('covers the client-side waits before sending, the configured request timeout and a margin', () => {
    expect(inFlightAmbiguityMs(60_000)).toBe(156_000);
    expect(inFlightAmbiguityMs(600_000)).toBe(696_000);
  });
});

describe('video thumbnail lookup', () => {
  const conn = { userId: 'u', profileId: 'p', accessToken: 'token' };
  const metaError = (code: number, subcode?: number) =>
    new MetaApiError(classifyGraphError({ code, error_subcode: subcode, message: 'x' }, 400));
  /** The service with a Graph client whose thumbnail lookup fails with `err` (no other dependency is used). */
  const failingLookup = (err: Error) =>
    new MetaMediaService(
      undefined as never,
      undefined as never,
      undefined as never,
      { get: () => Promise.reject(err) } as never,
      undefined as never,
    );
  const lookup = (err: Error) =>
    failingLookup(err)
      .preferredThumbnail(conn, '123')
      .catch((e: unknown) => e);

  it('throws throttling and token errors instead of reporting "no thumbnail yet"', async () => {
    expect(((await lookup(metaError(17, 2446079))) as MetaApiError).category).toBe('RATE_LIMIT');
    expect(((await lookup(metaError(190, 460))) as MetaApiError).category).toBe('AUTH');
    expect(await lookup(metaError(100))).toBeNull();
  });
});
