import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../infra/redis/redis.service';
import { SettingsService } from '../../settings/settings.service';
import { AppLogger } from '../../../infra/logger/logger';
import { MetaApiError } from './meta-errors';
import { ParsedUsage, isEmptyUsage } from './usage-headers';

export interface RateScope {
  /** Meta app id of the token (or the profile id when unknown). */
  appKey: string;
  profileId: string;
  metaAccountId?: string;
  businessId?: string;
  /** ads_management | ads_insights | ... (derived from the call category). */
  useCase: 'ads_management' | 'ads_insights' | 'other';
}

interface ScopeState {
  pct: number;
  blockedUntil: number;
  at: number;
}

/** Thrown before a request is sent when a scope is currently throttled. Jobs defer themselves instead of retrying. */
export class MetaRateLimitedError extends MetaApiError {
  constructor(readonly retryAfterMs: number, scope: string) {
    super({
      friendlyMessage: `Meta API limit reached (${scope}). The request was postponed by ${Math.ceil(retryAfterMs / 1000)} s.`,
      category: 'RATE_LIMIT',
      retryable: true,
      retryAfterMs,
    });
    this.name = 'MetaRateLimitedError';
  }
}

const STATE_TTL_S = 3600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Central Meta rate-limit manager (shared by every worker through Redis).
 *
 * Before each call:  if any relevant scope (app, token/user, ad account, business use case) is blocked,
 *                    the call is not sent and MetaRateLimitedError(retryAfter) is thrown;
 *                    above the "throttle" threshold calls are paced (short sleeps);
 *                    above the "pause" threshold the scope is treated as blocked for a cool-down.
 * After each call:   usage headers update the scope states (and BUC estimated_time_to_regain_access).
 * On throttling:     the scope indicated by the error code is blocked using the header-provided regain
 *                    time or an exponential back-off with jitter (1 min … 30 min).
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
    }
    if (scope.businessId) k.business = this.redis.key('meta', 'rl', 'buc', scope.businessId, scope.useCase);
    return k;
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
      if (st.blockedUntil > now) throw new MetaRateLimitedError(st.blockedUntil - now, names[i]);
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
      const key = this.redis.key('meta', 'rl', 'buc', b.businessId, useCase);
      const pct = Math.max(b.callCount, b.totalCputime, b.totalTime);
      writes.push([key, { pct, blockedUntil: b.regainMinutes > 0 ? now + b.regainMinutes * 60_000 : 0, at: now }]);
    }
    if (!writes.length) return;
    const pipe = this.redis.client.pipeline();
    for (const [k, v] of writes) pipe.set(k, JSON.stringify(v), 'EX', STATE_TTL_S);
    await pipe.exec();
  }

  /** Records a throttling error and returns how long the caller should wait. */
  async onRateLimited(scope: RateScope, err: MetaApiError, usage: ParsedUsage): Promise<number> {
    const keys = this.keys(scope);
    let delay = 0;
    for (const b of usage.business) delay = Math.max(delay, b.regainMinutes * 60_000);
    if (usage.adAccount?.resetSeconds) delay = Math.max(delay, usage.adAccount.resetSeconds * 1000);

    const code = err.metaCode;
    const target =
      code === 4 ? keys.app : code === 17 ? keys.account ?? keys.token : code && code >= 80000 ? keys.business ?? keys.account ?? keys.token : keys.account ?? keys.token;
    if (!delay) {
      const strikeKey = `${target}:strikes`;
      const strikes = await this.redis.client.incr(strikeKey);
      await this.redis.client.expire(strikeKey, 3600);
      delay = Math.min(30 * 60_000, 60_000 * 2 ** Math.min(strikes - 1, 5));
    }
    delay = Math.round(delay * (1 + Math.random() * 0.2));
    const now = Date.now();
    await this.redis.client.set(target, JSON.stringify({ pct: 100, blockedUntil: now + delay, at: now } satisfies ScopeState), 'EX', STATE_TTL_S);
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
