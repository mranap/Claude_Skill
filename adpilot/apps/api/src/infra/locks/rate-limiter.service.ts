import { Injectable } from '@nestjs/common';
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

  async hit(bucket: string, identifier: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const key = this.redis.key('rl', bucket, identifier);
    const [count, ttl] = (await this.redis.client.eval(HIT_SCRIPT, 1, key, String(windowMs))) as [number, number];
    return { allowed: count <= limit, count, retryAfterMs: count <= limit ? 0 : Math.max(ttl, 0) };
  }

  async reset(bucket: string, identifier: string): Promise<void> {
    await this.redis.client.del(this.redis.key('rl', bucket, identifier));
  }
}
