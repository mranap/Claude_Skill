import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../infra/redis/redis.service';

/** Wrong passwords from all sources together that lock an address (a multiple of the per-source limit). */
export const ACCOUNT_LOCK_FACTOR = 5;
/** Wrong second-factor codes per user within the window that lock the second factor and the account. */
export const MFA_MAX_FAILURES = 10;
const MFA_WINDOW_MS = 15 * 60_000;
const FAILURE_MEMORY_MS = 24 * 3600_000;

/**
 * KEYS[1] = hash of one address. ARGV = count field, lock field, max, lock ms, key ttl ms.
 * Counts a failure; at `max` the counter restarts and the lock field gets its expiry (Redis clock). Returns 1 on lock.
 */
const FAIL_SCRIPT = `
local n = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('PEXPIRE', KEYS[1], ARGV[5])
if n >= tonumber(ARGV[3]) then
  local t = redis.call('TIME')
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  redis.call('HDEL', KEYS[1], ARGV[1])
  redis.call('HSET', KEYS[1], ARGV[2], now + tonumber(ARGV[4]))
  return 1
end
return 0`;

/** KEYS[1] = hash, ARGV[1] = lock field. Returns the remaining lock time in ms (0 when not locked). */
const LOCK_SCRIPT = `
local untilMs = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
if untilMs > now then return untilMs - now end
return 0`;

const MFA_FAIL_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if n >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return 1
end
return 0`;

/**
 * Brute-force protection for sign-in, kept in Redis and shared by all API replicas.
 *
 * - Per address + source IP: after `maxFailedLogins` wrong passwords that source is locked for `lockoutMinutes`.
 *   An attacker on one IP therefore cannot lock the owner out; the account-wide lock (`users.lockedUntil`) only
 *   follows `ACCOUNT_LOCK_FACTOR` times as many failures from all sources together.
 * - Unknown addresses get the same address lock as real accounts, so a "locked" answer never reveals that an
 *   account exists.
 * - Second factor: `MFA_MAX_FAILURES` wrong codes per user within 15 minutes lock it, whether the codes came
 *   through sign-in or the 2FA settings endpoints; the caller also locks the account.
 * Identifiers are hashed, so no e-mail address or IP appears in key names.
 */
@Injectable()
export class LoginGuardService {
  constructor(private readonly redis: RedisService) {}

  private hash(value: string): string {
    return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 32);
  }

  /** All failure counters and locks of one address live in one hash, so a password reset clears them at once. */
  private addressKey(email: string): string {
    return this.redis.key('auth', 'login', this.hash(email));
  }

  private async lockMs(key: string, field: string): Promise<number> {
    return Number(await this.redis.client.eval(LOCK_SCRIPT, 1, key, field));
  }

  private async fail(key: string, countField: string, lockField: string, max: number, lockMs: number): Promise<boolean> {
    const locked = await this.redis.client.eval(FAIL_SCRIPT, 1, key, countField, lockField, String(max), String(lockMs), String(Math.max(FAILURE_MEMORY_MS, lockMs)));
    return locked === 1;
  }

  sourceLockMs(email: string, ip: string): Promise<number> {
    return this.lockMs(this.addressKey(email), `lock:${this.hash(ip)}`);
  }

  async passwordFailed(email: string, ip: string, max: number, lockMs: number): Promise<void> {
    const src = this.hash(ip);
    await this.fail(this.addressKey(email), `fail:${src}`, `lock:${src}`, max, lockMs);
  }

  /** Lock of an address without an account (for real accounts the lock is `users.lockedUntil`). */
  unknownAddressLockMs(email: string): Promise<number> {
    return this.lockMs(this.addressKey(email), 'lock');
  }

  async unknownAddressFailed(email: string, max: number, lockMs: number): Promise<void> {
    await this.fail(this.addressKey(email), 'fail', 'lock', max, lockMs);
  }

  /** A successful sign-in clears the failures of its own source only. */
  async signedIn(email: string, ip: string): Promise<void> {
    const src = this.hash(ip);
    await this.redis.client.hdel(this.addressKey(email), `fail:${src}`, `lock:${src}`);
  }

  /** Clears the failures and locks of every source of this address (password reset, administrator unlock). */
  async clearAddress(email: string): Promise<void> {
    await this.redis.client.del(this.addressKey(email));
  }

  secondFactorLockMs(userId: string): Promise<number> {
    return this.redis.client.pttl(this.redis.key('auth', 'mfa-lock', userId)).then((ms) => Math.max(0, ms));
  }

  /** Returns true when this failure locked the second factor. */
  async secondFactorFailed(userId: string, lockMs: number): Promise<boolean> {
    const locked = await this.redis.client.eval(
      MFA_FAIL_SCRIPT,
      2,
      this.redis.key('auth', 'mfa-fail', userId),
      this.redis.key('auth', 'mfa-lock', userId),
      String(MFA_WINDOW_MS),
      String(MFA_MAX_FAILURES),
      String(lockMs),
    );
    return locked === 1;
  }

  async secondFactorPassed(userId: string): Promise<void> {
    await this.redis.client.del(this.redis.key('auth', 'mfa-fail', userId));
  }

  /** Lifts the second-factor lock (password reset, administrator unlock or 2FA reset). */
  async clearSecondFactor(userId: string): Promise<void> {
    await this.redis.client.del(this.redis.key('auth', 'mfa-fail', userId), this.redis.key('auth', 'mfa-lock', userId));
  }
}
