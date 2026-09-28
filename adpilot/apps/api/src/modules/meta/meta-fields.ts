/**
 * Field lists requested from the Marketing API. Kept in one file so a Graph API version upgrade only needs
 * to review this list (see docs/META_API.md → "Upgrading the Graph API version").
 */
export const AD_ACCOUNT_FIELDS = [
  'id',
  'account_id',
  'name',
  'currency',
  'timezone_name',
  'timezone_offset_hours_utc',
  'account_status',
  'disable_reason',
  'amount_spent',
  'balance',
  'spend_cap',
  'min_daily_budget',
  'is_prepay_account',
  'default_dsa_payor',
  'default_dsa_beneficiary',
  'business{id,name}',
].join(',');

/** Lightweight fields for periodic status checks. */
export const AD_ACCOUNT_STATUS_FIELDS = [
  'id',
  'account_id',
  'name',
  'account_status',
  'disable_reason',
  'amount_spent',
  'balance',
  'spend_cap',
  'currency',
  'timezone_name',
  'timezone_offset_hours_utc',
].join(',');

export const BUSINESS_FIELDS = 'id,name,verification_status';

export const PAGE_FIELDS = 'id,name,category,picture{url},instagram_business_account{id,username}';

export const PIXEL_FIELDS = 'id,name,last_fired_time,is_unavailable';

export const CUSTOM_AUDIENCE_FIELDS = 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound';

export const CAMPAIGN_FIELDS = [
  'id',
  'name',
  'objective',
  'status',
  'effective_status',
  'daily_budget',
  'lifetime_budget',
  'budget_remaining',
  'spend_cap',
  'bid_strategy',
  'buying_type',
  'special_ad_categories',
  'is_adset_budget_sharing_enabled',
  'start_time',
  'stop_time',
  'created_time',
  'updated_time',
  'issues_info',
].join(',');

export const ADSET_FIELDS = [
  'id',
  'name',
  'campaign_id',
  'status',
  'effective_status',
  'daily_budget',
  'lifetime_budget',
  'budget_remaining',
  'optimization_goal',
  'billing_event',
  'bid_strategy',
  'bid_amount',
  'destination_type',
  'targeting',
  'start_time',
  'end_time',
  'created_time',
  'updated_time',
  'issues_info',
].join(',');

export const AD_FIELDS = [
  'id',
  'name',
  'adset_id',
  'campaign_id',
  'status',
  'effective_status',
  'creative{id}',
  'ad_review_feedback',
  'issues_info',
  'created_time',
  'updated_time',
].join(',');

export function actId(metaAccountId: string): string {
  return metaAccountId.startsWith('act_') ? metaAccountId : `act_${metaAccountId}`;
}

export function toBigIntOrNull(v: unknown): bigint | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  return BigInt(s);
}
