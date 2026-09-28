import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;
const EXTEND_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0`;
const SEMAPHORE_ACQUIRE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`;

export interface LockHandle {
  key: string;
  token: string;
}

/**
 * Redis based distributed locks (single-instance Redlock variant: SET NX PX + compare-and-delete).
 * Used together with database leases/unique constraints — never as the only protection for money-affecting
 * operations.
 */
@Injectable()
export class LockService {
  constructor(private readonly redis: RedisService) {}

  async acquire(name: string, ttlMs: number): Promise<LockHandle | null> {
    const key = this.redis.key('lock', name);
    const token = randomUUID();
    const ok = await this.redis.client.set(key, token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? { key, token } : null;
  }

  async release(lock: LockHandle): Promise<void> {
    await this.redis.client.eval(RELEASE_SCRIPT, 1, lock.key, lock.token);
  }

  async extend(lock: LockHandle, ttlMs: number): Promise<boolean> {
    const res = await this.redis.client.eval(EXTEND_SCRIPT, 1, lock.key, lock.token, String(ttlMs));
    return res === 1;
  }

  /** Runs `fn` while holding the lock; returns `{ acquired: false }` when somebody else holds it. */
  async withLock<T>(
    name: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; result: T } | { acquired: false }> {
    const lock = await this.acquire(name, ttlMs);
    if (!lock) return { acquired: false };
    const renew = setInterval(() => void this.extend(lock, ttlMs).catch(() => undefined), Math.max(1000, ttlMs / 3));
    try {
      return { acquired: true, result: await fn() };
    } finally {
      clearInterval(renew);
      await this.release(lock).catch(() => undefined);
    }
  }

  /** Counting semaphore with automatic expiry of crashed holders. */
  async acquireSlot(name: string, limit: number, ttlMs: number): Promise<string | null> {
    const id = randomUUID();
    const res = await this.redis.client.eval(
      SEMAPHORE_ACQUIRE,
      1,
      this.redis.key('sem', name),
      String(Date.now()),
      String(ttlMs),
      String(limit),
      id,
    );
    return res === 1 ? id : null;
  }

  async releaseSlot(name: string, id: string): Promise<void> {
    await this.redis.client.zrem(this.redis.key('sem', name), id);
  }
}
