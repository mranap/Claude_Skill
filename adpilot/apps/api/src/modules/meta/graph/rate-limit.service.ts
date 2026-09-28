import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../infra/redis/redis.service';
import { SettingsService } from '../../settings/settings.service';
import { AppLogger } from '../../../infra/logger/logger';
import { MetaApiError, classifyGraphError, isBudgetChangeLimit } from './meta-errors';
import { ParsedUsage, isEmptyUsage } from './usage-headers';

export interface RateScope {
  /** Meta app id of the token (or the profile id when unknown). */
  appKey: string;
  profileId: string;
  metaAccountId?: string;
  businessId?: string;
  /**
   * Write to one object, as `<object id>:<operation>` (e.g. an ad set budget change). Some limits apply per
   * object and operation (613/1487632): they block only this key, never the whole ad account.
   */
  objectKey?: string;
  /** ads_management | ads_insights | ... (derived from the call category). */
  useCase: 'ads_management' | 'ads_insights' | 'other';
}

interface ScopeState {
  pct: number;
  blockedUntil: number;
  at: number;
  /** Meta error that caused the block (throttling errors only). */
  code?: number;
  subcode?: number;
}

/**
 * Thrown before a request is sent when a scope is currently throttled. Jobs defer themselves instead of retrying.
 * `details.code`/`subcode` name the Meta error that caused the block, so a caller can tell a per-object limit
 * (isBudgetChangeLimit) from a throttled ad account.
 */
export class MetaRateLimitedError extends MetaApiError {
  constructor(readonly retryAfterMs: number, scope: string, cause: { code?: number; subcode?: number } = {}) {
    super({
      friendlyMessage: isBudgetChangeLimit(cause)
        ? classifyGraphError({ code: cause.code, error_subcode: cause.subcode }, undefined, retryAfterMs).friendlyMessage
        : `Meta API limit reached (${scope}). The request was postponed by ${Math.ceil(retryAfterMs / 1000)} s.`,
      category: 'RATE_LIMIT',
      retryable: true,
      retryAfterMs,
      code: cause.code,
      subcode: cause.subcode,
    });
    this.name = 'MetaRateLimitedError';
  }
}

const STATE_TTL_S = 3600;
/** Meta blocks the budget of an ad set for an hour once it changed 4 times within an hour (613/1487632). */
const BUDGET_CHANGE_BLOCK_MS = 60 * 60_000;
const SCOPE_LABELS: Record<string, string> = { buc: 'business use case', object: 'changes of this object' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stores scope states but never shortens a block: a response that was in flight when a throttling error blocked
 * the scope reports `blockedUntil: 0`, and must not lift that block (a kept block keeps its cause). The key lives
 * at least as long as its block.
 * KEYS: state keys. ARGV: minimum TTL (s), now (ms), then one JSON state per key. Returns each resulting blockedUntil.
 */
const MERGE_STATES = `
local out = {}
for i, key in ipairs(KEYS) do
  local state = cjson.decode(ARGV[i + 2])
  local prev = redis.call('GET', key)
  if prev then
    local ok, old = pcall(cjson.decode, prev)
    local kept = ok and type(old) == 'table' and tonumber(old.blockedUntil) or 0
    if kept > state.blockedUntil then
      state.blockedUntil = kept
      state.code = old.code
      state.subcode = old.subcode
    end
  end
  local ttl = math.max(tonumber(ARGV[1]), math.ceil((state.blockedUntil - tonumber(ARGV[2])) / 1000))
  redis.call('SET', key, cjson.encode(state), 'EX', ttl)
  out[i] = tostring(state.blockedUntil)
end
return out`;

/**
 * Central Meta rate-limit manager (shared by every worker through Redis).
 *
 * Before each call:  if any relevant scope (app, token/user, ad account, business use case, object write) is
 *                    blocked, the call is not sent and MetaRateLimitedError(retryAfter) is thrown;
 *                    above the "throttle" threshold calls are paced (short sleeps);
 *                    above the "pause" threshold the scope is treated as blocked for a cool-down.
 * After each call:   usage headers update the scope states (and BUC estimated_time_to_regain_access).
 * On throttling:     the scope indicated by the error code is blocked using the header-provided regain
 *                    time or an exponential back-off with jitter (1 min … 30 min).
 * Later responses only ever extend a block, never shorten or lift it.
 */
@Injectable()
export class MetaRateLimitService {
  private readonly logger = new AppLogger('MetaRateLimit');

  constructor(
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  private keys(scope: RateScope): Record<string, string> {
    const k: Record<string, string> = {
      app: this.redis.key('meta', 'rl', 'app', scope.appKey),
      token: this.redis.key('meta', 'rl', 'tok', scope.profileId),
    };
    if (scope.metaAccountId) {
      k.account = this.redis.key('meta', 'rl', 'acct', scope.metaAccountId);
      if (scope.useCase === 'ads_insights') k.insights = `${k.account}:insights`;
      // Business Use Case limits of the Marketing API are counted per ad account: X-Business-Use-Case-Usage
      // reports them under the ad account id, which afterResponse stores under this same key.
      k.buc = this.bucKey(scope.metaAccountId, scope.useCase);
    }
    if (scope.businessId) k.business = this.bucKey(scope.businessId, scope.useCase);
    if (scope.objectKey) k.object = this.redis.key('meta', 'rl', 'obj', scope.objectKey);
    return k;
  }

  private bucKey(objectId: string, useCase: RateScope['useCase']): string {
    return this.redis.key('meta', 'rl', 'buc', objectId.replace(/^act_/, ''), useCase);
  }

  /** Writes states through MERGE_STATES; returns the resulting blockedUntil of each key. */
  private async store(writes: [string, ScopeState][]): Promise<number[]> {
    const res = (await this.redis.client.eval(
      MERGE_STATES,
      writes.length,
      ...writes.map(([key]) => key),
      String(STATE_TTL_S),
      String(Date.now()),
      ...writes.map(([, state]) => JSON.stringify(state)),
    )) as string[];
    return res.map(Number);
  }

  async beforeRequest(scope: RateScope): Promise<void> {
    const { throttleThresholdPct, pauseThresholdPct } = await this.settings.get('meta');
    const keys = this.keys(scope);
    const names = Object.keys(keys);
    const values = await this.redis.client.mget(...names.map((n) => keys[n]));
    const now = Date.now();
    let maxPct = 0;
    for (let i = 0; i < names.length; i++) {
      const raw = values[i];
      if (!raw) continue;
      const st = JSON.parse(raw) as ScopeState;
      if (st.blockedUntil > now) throw new MetaRateLimitedError(st.blockedUntil - now, SCOPE_LABELS[names[i]] ?? names[i], st);
      // Usage percentages decay; ignore data older than 10 minutes for pacing decisions.
      if (now - st.at < 10 * 60_000) maxPct = Math.max(maxPct, st.pct);
    }
    if (maxPct >= pauseThresholdPct) {
      const cooldown = 60_000 + Math.round(Math.random() * 15_000);
      throw new MetaRateLimitedError(cooldown, `usage ${Math.round(maxPct)}%`);
    }
    if (maxPct >= throttleThresholdPct) {
      const ratio = (maxPct - throttleThresholdPct) / Math.max(1, pauseThresholdPct - throttleThresholdPct);
      await sleep(Math.round(500 + ratio * 4500));
    }
  }

  async afterResponse(scope: RateScope, usage: ParsedUsage): Promise<void> {
    if (isEmptyUsage(usage)) return;
    const keys = this.keys(scope);
    const now = Date.now();
    const writes: [string, ScopeState][] = [];
    if (usage.app) {
      writes.push([keys.app, { pct: Math.max(usage.app.callCount, usage.app.totalTime, usage.app.totalCputime), blockedUntil: 0, at: now }]);
    }
    if (usage.adAccount && keys.account) {
      const pct = usage.adAccount.utilPct;
      const blockedUntil = pct >= 100 && usage.adAccount.resetSeconds > 0 ? now + usage.adAccount.resetSeconds * 1000 : 0;
      writes.push([keys.account, { pct, blockedUntil, at: now }]);
    }
    if (usage.insights && keys.insights) {
      writes.push([keys.insights, { pct: Math.max(usage.insights.accountPct, usage.insights.appPct), blockedUntil: 0, at: now }]);
    }
    for (const b of usage.business) {
      const useCase = b.type === 'ads_insights' ? 'ads_insights' : b.type === 'ads_management' ? 'ads_management' : 'other';
      const pct = Math.max(b.callCount, b.totalCputime, b.totalTime);
      writes.push([this.bucKey(b.businessId, useCase), { pct, blockedUntil: b.regainMinutes > 0 ? now + b.regainMinutes * 60_000 : 0, at: now }]);
    }
    if (!writes.length) return;
    await this.store(writes);
  }

  /** Records a throttling error and returns how long the caller should wait. */
  async onRateLimited(scope: RateScope, err: MetaApiError, usage: ParsedUsage): Promise<number> {
    const keys = this.keys(scope);
    const code = err.metaCode;
    let delay = 0;
    let target: string | undefined;
    if (isBudgetChangeLimit({ code, subcode: err.metaSubcode })) {
      // Only the budget changes of this object are blocked; the ad account and every other call keep working.
      delay = BUDGET_CHANGE_BLOCK_MS;
      target = keys.object;
    } else {
      for (const b of usage.business) delay = Math.max(delay, b.regainMinutes * 60_000);
      if (usage.adAccount?.resetSeconds) delay = Math.max(delay, usage.adAccount.resetSeconds * 1000);
      target =
        code === 4
          ? keys.app
          : code === 17
            ? keys.account ?? keys.token
            : code && code >= 80000
              ? keys.business ?? keys.buc ?? keys.account ?? keys.token
              : keys.account ?? keys.token;
      if (!delay) {
        const strikeKey = `${target}:strikes`;
        const strikes = await this.redis.client.incr(strikeKey);
        await this.redis.client.expire(strikeKey, 3600);
        delay = Math.min(30 * 60_000, 60_000 * 2 ** Math.min(strikes - 1, 5));
      }
    }
    delay = Math.round(delay * (1 + Math.random() * 0.2));
    if (!target) return delay;
    const now = Date.now();
    // A longer block that is already in place (an earlier strike, a BUC regain time) is kept.
    const [blockedUntil] = await this.store([[target, { pct: 100, blockedUntil: now + delay, at: now, code, subcode: err.metaSubcode }]]);
    delay = Math.max(delay, blockedUntil - now);
    this.logger.warn('Meta rate limit hit', { code, subcode: err.metaSubcode, scope: target.split(':').slice(-2).join(':'), delayMs: delay });
    return delay;
  }

  /** Current states for the admin monitoring page. */
  async snapshot(): Promise<{ key: string; state: ScopeState }[]> {
    const out: { key: string; state: ScopeState }[] = [];
    let cursor = '0';
    const pattern = this.redis.key('meta', 'rl', '*');
    do {
      const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) {
        const vals = await this.redis.client.mget(...keys);
        keys.forEach((k, i) => {
          if (vals[i] && !k.endsWith(':strikes')) out.push({ key: k.replace(`${this.redis.prefix}:meta:rl:`, ''), state: JSON.parse(vals[i]) });
        });
      }
    } while (cursor !== '0' && out.length < 1000);
    return out;
  }
}
