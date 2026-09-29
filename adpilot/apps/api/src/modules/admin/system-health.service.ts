import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { MetaConnectivityService } from '../meta/meta-connectivity.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { SmtpService } from '../mail/smtp.service';

export interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error' | 'disabled';
  detail: string;
  latencyMs?: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: Error; ms: number }> {
  const started = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - started };
  } catch (err) {
    return { error: err as Error, ms: Date.now() - started };
  }
}

/** Technical health of every dependency, shown on the Super Admin dashboard. */
@Injectable()
export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly meta: MetaConnectivityService,
    private readonly telegram: TelegramBotService,
    private readonly smtp: SmtpService,
  ) {}

  async check(opts: { deep?: boolean } = {}): Promise<HealthCheck[]> {
    const [db, redis, storage, meta, workers, scheduler, email, tg] = await Promise.all([
      timed(() => this.prisma.$queryRaw`SELECT 1`),
      timed(() => this.redis.client.ping()),
      timed(() => this.storage.check()),
      timed(() => this.meta.check()),
      timed(() => this.workerHeartbeats()),
      timed(() => this.redis.client.get(this.redis.key('scheduler', 'hb'))),
      timed(() => this.emailCheck(!!opts.deep)),
      timed(() => this.telegramCheck()),
    ]);
    const checks: HealthCheck[] = [
      {
        name: 'Database',
        status: db.error ? 'error' : 'ok',
        detail: db.error?.message ?? 'PostgreSQL reachable',
        latencyMs: db.ms,
      },
      {
        name: 'Redis',
        status: redis.error ? 'error' : 'ok',
        detail: redis.error?.message ?? 'Redis reachable',
        latencyMs: redis.ms,
      },
      {
        name: 'Storage',
        status: storage.error || !storage.value?.ok ? 'error' : 'ok',
        detail: storage.error?.message ?? storage.value?.detail ?? '',
        latencyMs: storage.ms,
      },
      {
        name: 'Meta API connectivity',
        status: meta.error || !meta.value?.ok ? 'error' : 'ok',
        detail: meta.error?.message ?? `${meta.value?.detail} (Graph API ${meta.value?.version})`,
        latencyMs: meta.value?.latencyMs,
      },
      {
        name: 'Workers',
        status: workers.error ? 'error' : (workers.value?.length ?? 0) > 0 ? 'ok' : 'error',
        detail: workers.error?.message ?? `${workers.value?.length ?? 0} worker process(es) alive`,
      },
      {
        name: 'Scheduler',
        status: scheduler.error ? 'error' : scheduler.value ? 'ok' : 'error',
        detail:
          scheduler.error?.message ??
          (scheduler.value
            ? `Leader: ${(JSON.parse(scheduler.value) as { host: string }).host}`
            : 'No scheduler heartbeat in the last minute'),
      },
      email.value ?? { name: 'Email (SMTP)', status: 'error', detail: email.error?.message ?? 'unknown' },
      tg.value ?? { name: 'Telegram bot', status: 'error', detail: tg.error?.message ?? 'unknown' },
    ];
    return checks;
  }

  async workerHeartbeats(): Promise<Record<string, unknown>[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        this.redis.key('workers', 'hb', '*'),
        'COUNT',
        100,
      );
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    if (!keys.length) return [];
    const values = await this.redis.client.mget(...keys);
    return values.filter((v): v is string => !!v).map((v) => JSON.parse(v) as Record<string, unknown>);
  }

  private async emailCheck(deep: boolean): Promise<HealthCheck> {
    const s = await this.settings.get('smtp');
    if (!s.enabled) return { name: 'Email (SMTP)', status: 'disabled', detail: 'SMTP is not enabled' };
    if (!deep) return { name: 'Email (SMTP)', status: 'ok', detail: `Configured: ${s.host}:${s.port}` };
    const res = await timed(() => this.smtp.verify());
    return {
      name: 'Email (SMTP)',
      status: res.error ? 'error' : 'ok',
      detail: res.error?.message ?? 'SMTP connection verified',
      latencyMs: res.ms,
    };
  }

  private async telegramCheck(): Promise<HealthCheck> {
    if (!(await this.telegram.isConfigured()))
      return { name: 'Telegram bot', status: 'disabled', detail: 'Telegram bot is not configured' };
    const res = await timed(() => this.telegram.getMe());
    return {
      name: 'Telegram bot',
      status: res.error ? 'error' : 'ok',
      detail: res.error?.message ?? `@${res.value?.username}`,
      latencyMs: res.ms,
    };
  }
}
