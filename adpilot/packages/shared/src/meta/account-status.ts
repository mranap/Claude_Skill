/**
 * Ad account `account_status` values returned by the Marketing API (AdAccount.account_status) and their
 * display mapping. The raw numeric value is always stored; the key/label are derived.
 */
export const AD_ACCOUNT_STATUS_KEYS = [
  'ACTIVE',
  'DISABLED',
  'UNSETTLED',
  'PENDING_RISK_REVIEW',
  'PENDING_SETTLEMENT',
  'IN_GRACE_PERIOD',
  'PENDING_CLOSURE',
  'CLOSED',
  'ANY_ACTIVE',
  'ANY_CLOSED',
  'UNKNOWN',
] as const;
export type AdAccountStatusKey = (typeof AD_ACCOUNT_STATUS_KEYS)[number];

export const AD_ACCOUNT_STATUS_BY_CODE: Record<number, AdAccountStatusKey> = {
  1: 'ACTIVE',
  2: 'DISABLED',
  3: 'UNSETTLED',
  7: 'PENDING_RISK_REVIEW',
  8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD',
  100: 'PENDING_CLOSURE',
  101: 'CLOSED',
  201: 'ANY_ACTIVE',
  202: 'ANY_CLOSED',
};

export type StatusTone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

/** Simplified display groups requested by the product: Active / Disabled / Pending / Unsettled / Closed / Unknown. */
export const AD_ACCOUNT_STATUS_DISPLAY: Record<
  AdAccountStatusKey,
  { label: string; group: string; tone: StatusTone; description: string }
> = {
  ACTIVE: { label: 'Active', group: 'Active', tone: 'success', description: 'The account can run ads.' },
  DISABLED: {
    label: 'Disabled',
    group: 'Disabled',
    tone: 'danger',
    description: 'Meta disabled the account. See the disable reason and Account Quality.',
  },
  UNSETTLED: {
    label: 'Unsettled',
    group: 'Unsettled',
    tone: 'warning',
    description: 'There is an outstanding balance. Settle the payment to resume delivery.',
  },
  PENDING_RISK_REVIEW: {
    label: 'Pending risk review',
    group: 'Pending',
    tone: 'warning',
    description: 'Meta is reviewing the account.',
  },
  PENDING_SETTLEMENT: {
    label: 'Pending settlement',
    group: 'Pending',
    tone: 'warning',
    description: 'A payment is being processed.',
  },
  IN_GRACE_PERIOD: {
    label: 'Grace period',
    group: 'Pending',
    tone: 'warning',
    description: 'Payment problem; ads still run for a limited time.',
  },
  PENDING_CLOSURE: {
    label: 'Pending closure',
    group: 'Closed',
    tone: 'neutral',
    description: 'The account is being closed.',
  },
  CLOSED: { label: 'Closed', group: 'Closed', tone: 'neutral', description: 'The account is closed.' },
  ANY_ACTIVE: {
    label: 'Active',
    group: 'Active',
    tone: 'success',
    description: 'Active (aggregate status).',
  },
  ANY_CLOSED: {
    label: 'Closed',
    group: 'Closed',
    tone: 'neutral',
    description: 'Closed (aggregate status).',
  },
  UNKNOWN: {
    label: 'Unknown',
    group: 'Unknown',
    tone: 'neutral',
    description: 'The status could not be determined yet.',
  },
};

export function adAccountStatusKey(code: number | null | undefined): AdAccountStatusKey {
  if (code === null || code === undefined) return 'UNKNOWN';
  return AD_ACCOUNT_STATUS_BY_CODE[code] ?? 'UNKNOWN';
}

/** AdAccount.disable_reason values. */
export const AD_ACCOUNT_DISABLE_REASONS: Record<number, string> = {
  0: 'None',
  1: 'Ads integrity policy',
  2: 'Ads IP review',
  3: 'Risk / payment',
  4: 'Gray account shut down',
  5: 'Ads AFC review',
  6: 'Business integrity (RAR)',
  7: 'Permanently closed',
  8: 'Unused reseller account',
  9: 'Unused account',
  10: 'Umbrella ad account',
  11: 'Business Manager integrity policy',
  12: 'Misrepresented ad account',
  13: 'AOAB deshare legal entity',
  14: 'CTX thread review',
  15: 'Compromised ad account',
};

export function disableReasonLabel(code: number | null | undefined): string | null {
  if (code === null || code === undefined || code === 0) return null;
  return AD_ACCOUNT_DISABLE_REASONS[code] ?? `Reason #${code}`;
}
