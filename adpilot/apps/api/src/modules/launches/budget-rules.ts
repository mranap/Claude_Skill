import type { BidStrategy, BillingEvent } from '@adpilot/shared';

/**
 * Minimum budgets Meta enforces when campaigns and ad sets are created (Ad Set reference, "Bid/Budget
 * Validations", and error 2238055). All amounts are minor units of the ad account currency.
 *  - The ad account's `min_daily_budget` is the daily minimum for impression billing. Without a bid cap,
 *    billing on clicks, likes or video views needs five times as much ($2.50 against $0.50 in the reference
 *    table): LINK_CLICKS and THRUPLAY billing here.
 *  - With a bid cap the daily budget must be at least the bid (impression billing), or five times the bid
 *    when billing on clicks or actions.
 *  - Minimums are daily values that apply to lifetime budgets as well ("a campaign lasting 5 days will need
 *    at least $25" with a $5 minimum): the daily minimum over the scheduled duration.
 *  - A campaign budget must cover the minimum of every ad set it funds ("to account for all ad sets in this
 *    campaign", error 2238055).
 */

const DAY_MS = 86_400_000n;
const PER_RESULT_FACTOR = 5n;

export interface AdSetMinimumInput {
  /** The ad account's `min_daily_budget`; null when Meta did not report one. */
  accountMinDaily: bigint | null;
  billingEvent: BillingEvent;
  bidStrategy: BidStrategy;
  /** Bid cap / cost per result goal (`bid_amount`), when set. */
  bidAmount: bigint | null;
}

export interface AdSetMinimum {
  /** Minimum daily budget of one ad set. */
  daily: bigint;
  /** What the minimum is derived from (for messages). */
  basis: string;
}

/** Minimum daily budget of one ad set, or null when no minimum is known. */
export function adSetDailyMinimum(input: AdSetMinimumInput): AdSetMinimum | null {
  const perResult = input.billingEvent !== 'IMPRESSIONS';
  let min: AdSetMinimum | null = null;
  if (input.accountMinDaily !== null && input.accountMinDaily > 0n) {
    min =
      perResult && input.bidStrategy === 'LOWEST_COST_WITHOUT_CAP'
        ? { daily: input.accountMinDaily * PER_RESULT_FACTOR, basis: '5 × the ad account minimum when billing on link clicks or ThruPlays' }
        : { daily: input.accountMinDaily, basis: 'the ad account minimum' };
  }
  if (input.bidStrategy === 'LOWEST_COST_WITH_BID_CAP' && input.bidAmount !== null && input.bidAmount > 0n) {
    const byBid = perResult ? input.bidAmount * PER_RESULT_FACTOR : input.bidAmount;
    if (!min || byBid > min.daily) {
      min = { daily: byBid, basis: perResult ? '5 × the bid cap when billing on link clicks or ThruPlays' : 'the bid cap' };
    }
  }
  return min;
}

/** A daily minimum applied over a lifetime schedule, rounded up to the minor unit. */
export function lifetimeMinimum(daily: bigint, startMs: number, endMs: number): bigint {
  const duration = BigInt(Math.max(0, Math.trunc(endMs - startMs)));
  return (daily * duration + DAY_MS - 1n) / DAY_MS;
}
