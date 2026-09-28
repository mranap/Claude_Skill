import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../redis/redis.service';

const HIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}`;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

/** Fixed-window counters in Redis, shared by all API replicas (login, password reset, uploads...). */
@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  /** Identifiers (e-mail addresses, IPs) are hashed: no personal data in Redis key names. */
  private key(bucket: string, identifier: string): string {
    return this.redis.key(
      'rl',
      bucket,
      createHash('sha256').update(identifier.toLowerCase()).digest('hex').slice(0, 32),
    );
  }

  async hit(bucket: string, identifier: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const [count, ttl] = (await this.redis.client.eval(
      HIT_SCRIPT,
      1,
      this.key(bucket, identifier),
      String(windowMs),
    )) as [number, number];
    return { allowed: count <= limit, count, retryAfterMs: count <= limit ? 0 : Math.max(ttl, 0) };
  }

  async reset(bucket: string, identifier: string): Promise<void> {
    await this.redis.client.del(this.key(bucket, identifier));
  }
}
