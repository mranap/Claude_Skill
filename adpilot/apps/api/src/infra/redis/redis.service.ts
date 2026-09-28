import { Injectable, OnModuleDestroy } from '@nestjs/common';
import IORedis, { Redis, RedisOptions } from 'ioredis';
import { AppConfig } from '../../config/app-config';

/**
 * Shared Redis connections. `client` is used for caches, locks, rate limiting and pub/sub publishing.
 * BullMQ gets its own connections (it requires `maxRetriesPerRequest: null`).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly extra: Redis[] = [];

  constructor(private readonly config: AppConfig) {
    this.client = this.create('main');
  }

  get prefix(): string {
    return this.config.env.QUEUE_PREFIX;
  }

  /** Namespaced key helper: `adpilot:<parts...>`. */
  key(...parts: (string | number)[]): string {
    return [this.prefix, ...parts].join(':');
  }

  create(name: string, overrides: RedisOptions = {}): Redis {
    const conn = new IORedis(this.config.env.REDIS_URL, {
      connectionName: `${this.prefix}-${name}`,
      enableReadyCheck: true,
      lazyConnect: false,
      ...overrides,
    });
    conn.on('error', () => {
      /* errors are surfaced by commands / health checks; avoid unhandled 'error' events */
    });
    if (name !== 'main') this.extra.push(conn);
    return conn;
  }

  /** Connection options for BullMQ queues/workers. */
  bullConnection(name: string): Redis {
    return this.create(`bull-${name}`, { maxRetriesPerRequest: null });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), ...this.extra.map((c) => c.quit())]);
  }
}
