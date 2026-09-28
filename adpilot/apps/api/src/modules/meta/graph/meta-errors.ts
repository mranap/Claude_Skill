import type { MetaErrorCategory, MetaErrorDetails } from '@adpilot/shared';

/** Raw Graph API error object (`{ error: {...} }`). */
export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
  fbtrace_id?: string;
  error_data?: unknown;
}

/** Throttling codes: app (4), user (17), page (32), API-specific (613) and Business Use Case limits (80000-80014). */
export const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
/** Rate-limit style subcodes returned with code 17 / 4 for ad account level throttling. */
export const RATE_LIMIT_SUBCODES = new Set([2446079, 1487742, 1504022, 1504039]);
/**
 * 613/1487225: ad creation is limited per ad account, based on its daily spending limit. Not a short throttle:
 * retrying within minutes cannot succeed, and reads, rules and edits of the account are not limited.
 */
export const AD_CREATION_LIMIT_SUBCODE = 1487225;
/** 613/1487632: the budget of an ad set may change 4 times per hour; Meta then blocks budget changes of that ad set for an hour. */
export const BUDGET_CHANGE_LIMIT_SUBCODE = 1487632;

/** True for the per-object budget-change limit (only that object is throttled, not the ad account). */
export function isBudgetChangeLimit(e: { code?: number; subcode?: number }): boolean {
  return e.code === 613 && e.subcode === BUDGET_CHANGE_LIMIT_SUBCODE;
}

/**
 * The object does not exist or this token cannot see it: NOT_FOUND, or 100/33 ("does not exist, cannot be loaded
 * due to missing permissions"), which is classified VALIDATION because it may be a permission problem.
 */
export function isMissingOrInaccessible(e: { category: string; code?: number; subcode?: number }): boolean {
  return e.category === 'NOT_FOUND' || (e.code === 100 && e.subcode === 33);
}

export class MetaApiError extends Error {
  constructor(
    readonly details: MetaErrorDetails,
    readonly raw?: GraphErrorBody,
  ) {
    super(details.friendlyMessage);
    this.name = 'MetaApiError';
  }

  get category(): MetaErrorCategory {
    return this.details.category;
  }
  get retryable(): boolean {
    return this.details.retryable;
  }
  get metaCode(): number | undefined {
    return this.details.code;
  }
  get metaSubcode(): number | undefined {
    return this.details.subcode;
  }
  get isRateLimit(): boolean {
    return this.details.category === 'RATE_LIMIT';
  }
  get isAuth(): boolean {
    return this.details.category === 'AUTH';
  }
}

/** The request never reached Meta or the answer was lost. `sent` tells whether Meta may have processed it. */
export class MetaNetworkError extends MetaApiError {
  constructor(
    message: string,
    readonly sent: boolean,
    readonly viaProxy: boolean,
    code?: string,
  ) {
    super({
      friendlyMessage: viaProxy
        ? `Could not reach the Meta API through the configured proxy (${message}). Check the proxy of this Meta profile.`
        : `Could not reach the Meta API (${message}). The platform will retry automatically.`,
      category: viaProxy && !sent ? 'PROXY' : 'NETWORK',
      retryable: true,
      message: code ? `${code}: ${message}` : message,
    });
    this.name = 'MetaNetworkError';
  }
}

const AUTH_SUBCODE_MESSAGES: Record<number, string> = {
  458: 'The Meta app is no longer authorised by this user. Generate a new token.',
  459: 'The Facebook account is checkpointed. Log in to Facebook and complete the security check, then create a new token.',
  460: 'The token is no longer valid because the Facebook account password was changed. Generate a new token.',
  463: 'The access token has expired. Generate a new token and update the Meta profile.',
  464: 'The Facebook account is not confirmed. Confirm the account, then create a new token.',
  467: 'The access token is invalid (it was revoked or the user logged out). Generate a new token.',
  492: 'The token session is invalid (the user may have lost access to the Business). Generate a new token.',
};

function friendly(err: GraphErrorBody, httpStatus: number | undefined, category: MetaErrorCategory, retryAfterMs?: number): string {
  const code = err.code;
  const sub = err.error_subcode;
  const msg = err.message ?? '';
  if (category === 'AUTH') {
    return (sub !== undefined ? AUTH_SUBCODE_MESSAGES[sub] : undefined) ?? 'The Meta access token is invalid, expired or revoked. Update the token of this Meta profile.';
  }
  if (category === 'RATE_LIMIT') {
    const minutes = retryAfterMs ? Math.max(1, Math.round(retryAfterMs / 60000)) : undefined;
    if (isBudgetChangeLimit({ code, subcode: sub })) {
      return `Meta allows at most 4 budget changes per hour for an ad set, so this budget cannot be changed again${minutes ? ` for about ${minutes} min` : ' yet'}.`;
    }
    return `Meta API rate limit reached for this ${code === 4 ? 'app' : code === 17 ? 'user/ad account' : 'business/ad account'}. ` +
      `The platform slowed down and will retry automatically${minutes ? ` in about ${minutes} min` : ''}.`;
  }
  if (category === 'PERMISSION') {
    if (code === 294 || /ads_management/i.test(msg)) {
      return 'This token does not have the ads_management permission required to manage ads.';
    }
    if (/ads_read/i.test(msg)) return 'This token does not have the ads_read permission required to read ads data.';
    return 'The token (or its Facebook user/system user) does not have permission for this action. Check the permissions granted to the token and the user\'s role in the ad account / Business Manager.';
  }
  if (category === 'POLICY') {
    return err.error_user_msg ?? 'Meta blocked this action because of an advertising policy restriction. Check Account Quality in Business Manager.';
  }
  if (category === 'TRANSIENT') return 'The Meta API is temporarily unavailable. The platform will retry automatically.';
  if (category === 'NOT_FOUND') return 'The object does not exist in Meta anymore or this token cannot access it.';
  if (category === 'VALIDATION') {
    if (code === 613 && sub === AD_CREATION_LIMIT_SUBCODE) {
      return 'Meta limits how many ads this ad account can create, based on its daily spending limit, and the limit is reached. Try again later or raise the daily spending limit of the ad account.';
    }
    if (code === 100 && sub === 33) {
      return 'The object does not exist in Meta anymore, or the user or system user of this token has no access to it. Check its role on the ad account in Business Settings.';
    }
    if (/promoted_object/i.test(msg)) {
      return 'The selected optimization goal requires a promoted object (for example a Pixel with a conversion event, or a Facebook Page).';
    }
    if (/budget/i.test(msg) && /(too low|minimum|at least)/i.test(msg + (err.error_user_msg ?? ''))) {
      return err.error_user_msg ?? 'The budget is below the minimum allowed by Meta for this ad account currency and optimization goal.';
    }
    if (code === 2635) return 'The configured Graph API version is deprecated. Ask the administrator to update META_GRAPH_API_VERSION.';
    if (err.error_user_msg) return err.error_user_msg;
    return `Meta rejected the request: ${msg || 'invalid parameter'}.`;
  }
  if (httpStatus && httpStatus >= 500) return 'The Meta API returned a server error. The platform will retry automatically.';
  return err.error_user_msg ?? (msg ? `Meta API error: ${msg}` : 'Unknown Meta API error.');
}

/** Classifies a Graph API error (code/subcode/is_transient) into a platform category with retry semantics. */
export function classifyGraphError(err: GraphErrorBody, httpStatus?: number, retryAfterMs?: number): MetaErrorDetails {
  const code = err.code;
  const sub = err.error_subcode;
  let category: MetaErrorCategory;
  let retryable = false;

  if (code === 613 && sub === AD_CREATION_LIMIT_SUBCODE) {
    // A cap on the number of ads, not a throttle: fail with a clear message instead of deferring for hours.
    category = 'VALIDATION';
  } else if ((code !== undefined && RATE_LIMIT_CODES.has(code)) || (sub !== undefined && RATE_LIMIT_SUBCODES.has(sub))) {
    category = 'RATE_LIMIT';
    retryable = true;
  } else if (code === 190 || code === 102) {
    category = 'AUTH';
  } else if (code === 10 || code === 294 || (code !== undefined && code >= 200 && code <= 299)) {
    category = 'PERMISSION';
  } else if (code === 368) {
    category = 'POLICY';
  } else if (code === 803) {
    // 100/33 ("does not exist, cannot be loaded due to missing permissions, or does not support this operation")
    // is ambiguous: it stays in the generic code-100 class below, so it never marks an object as deleted.
    category = 'NOT_FOUND';
  } else if (
    code === 1 ||
    code === 2 ||
    // "We're facing some trouble with your account. Please try again later."
    code === 3910001 ||
    sub === 3910001 ||
    err.is_transient === true ||
    (httpStatus !== undefined && httpStatus >= 500 && code === undefined)
  ) {
    category = 'TRANSIENT';
    retryable = true;
  } else if (code === 100 || code === 2635 || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500)) {
    category = 'VALIDATION';
  } else {
    category = 'UNKNOWN';
    retryable = httpStatus !== undefined && httpStatus >= 500;
  }
  return {
    friendlyMessage: friendly(err, httpStatus, category, retryAfterMs),
    userTitle: err.error_user_title,
    userMessage: err.error_user_msg,
    code,
    subcode: sub,
    type: err.type,
    message: err.message,
    fbtraceId: err.fbtrace_id,
    httpStatus,
    category,
    retryable,
    retryAfterMs,
  };
}

/**
 * Token problems that change the Meta profile status directly: only an invalid or expired token (190/102).
 * Permission errors (10, 2xx, 294) are also returned for single objects (e.g. 200/1870034 "Custom Audience
 * terms not accepted"), so they do not prove that the token lost its ads permissions: the token check decides.
 */
export function authStatusFromError(e: MetaApiError): 'EXPIRED' | 'INVALID' | null {
  if (e.category === 'AUTH') return e.metaSubcode === 463 ? 'EXPIRED' : 'INVALID';
  return null;
}
