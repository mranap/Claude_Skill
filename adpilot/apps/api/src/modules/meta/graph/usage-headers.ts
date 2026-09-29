/**
 * Parsers for Meta rate-limit usage headers. All values are percentages (0-100) of the allowed quota.
 *
 *  X-App-Usage                 {"call_count":28,"total_time":25,"total_cputime":25}
 *  X-Ad-Account-Usage          {"acc_id_util_pct":9.67,"reset_time_duration":0,"ads_api_access_tier":"standard_access"}
 *  X-Business-Use-Case-Usage   {"<business_id>":[{"type":"ads_management","call_count":95,"total_cputime":20,
 *                                "total_time":20,"estimated_time_to_regain_access":0,"ads_api_access_tier":"..."}]}
 *  X-FB-Ads-Insights-Throttle  {"app_id_util_pct":100,"acc_id_util_pct":10,"ads_api_access_tier":"standard_access"}
 *
 * `estimated_time_to_regain_access` is in minutes; `reset_time_duration` is in seconds.
 */

export interface BucUsage {
  businessId: string;
  type: string;
  callCount: number;
  totalCputime: number;
  totalTime: number;
  /** Minutes until the business can call again (0 when not throttled). */
  regainMinutes: number;
  tier?: string;
}

export interface ParsedUsage {
  app?: { callCount: number; totalTime: number; totalCputime: number };
  adAccount?: { utilPct: number; resetSeconds: number; tier?: string };
  business: BucUsage[];
  insights?: { appPct: number; accountPct: number; tier?: string };
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

function parseJson(value: string | string[] | undefined): unknown {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseUsageHeaders(headers: Record<string, string | string[] | undefined>): ParsedUsage {
  const h = (name: string) => headers[name] ?? headers[name.toLowerCase()];
  const out: ParsedUsage = { business: [] };

  const app = parseJson(h('x-app-usage')) as Record<string, unknown> | undefined;
  if (app && typeof app === 'object') {
    out.app = {
      callCount: num(app.call_count),
      totalTime: num(app.total_time),
      totalCputime: num(app.total_cputime),
    };
  }

  const acct = parseJson(h('x-ad-account-usage')) as Record<string, unknown> | undefined;
  if (acct && typeof acct === 'object') {
    out.adAccount = {
      utilPct: num(acct.acc_id_util_pct),
      resetSeconds: num(acct.reset_time_duration),
      tier: typeof acct.ads_api_access_tier === 'string' ? acct.ads_api_access_tier : undefined,
    };
  }

  const buc = parseJson(h('x-business-use-case-usage')) as Record<string, unknown> | undefined;
  if (buc && typeof buc === 'object') {
    for (const [businessId, list] of Object.entries(buc)) {
      if (!Array.isArray(list)) continue;
      for (const item of list as Record<string, unknown>[]) {
        out.business.push({
          businessId,
          type: typeof item.type === 'string' ? item.type : 'unknown',
          callCount: num(item.call_count),
          totalCputime: num(item.total_cputime),
          totalTime: num(item.total_time),
          regainMinutes: num(item.estimated_time_to_regain_access),
          tier: typeof item.ads_api_access_tier === 'string' ? item.ads_api_access_tier : undefined,
        });
      }
    }
  }

  const ins = parseJson(h('x-fb-ads-insights-throttle')) as Record<string, unknown> | undefined;
  if (ins && typeof ins === 'object') {
    out.insights = {
      appPct: num(ins.app_id_util_pct),
      accountPct: num(ins.acc_id_util_pct),
      tier: typeof ins.ads_api_access_tier === 'string' ? ins.ads_api_access_tier : undefined,
    };
  }
  return out;
}

/** Highest utilisation percentage found in the parsed headers (for pacing decisions). */
export function maxUtilisation(u: ParsedUsage): number {
  return Math.max(
    u.app?.callCount ?? 0,
    u.app?.totalTime ?? 0,
    u.app?.totalCputime ?? 0,
    u.adAccount?.utilPct ?? 0,
    u.insights?.appPct ?? 0,
    u.insights?.accountPct ?? 0,
    ...u.business.map((b) => Math.max(b.callCount, b.totalCputime, b.totalTime)),
  );
}

export function isEmptyUsage(u: ParsedUsage): boolean {
  return !u.app && !u.adAccount && !u.insights && u.business.length === 0;
}
