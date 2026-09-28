import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SettingsService } from '../modules/settings/settings.service';
import { TelegramBotService } from '../modules/telegram/telegram-bot.service';
import { TelegramLinkService } from '../modules/telegram/telegram-link.service';
import { RedisService } from '../infra/redis/redis.service';
import { AppLogger } from '../infra/logger/logger';
import { SchedulerService } from './scheduler.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Long-polling receiver for Telegram updates (POLLING mode — no public URL needed). Runs only on the
 * scheduler leader so updates are consumed by exactly one process; the offset is persisted in Redis.
 */
@Injectable()
export class TelegramPollerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new AppLogger('TelegramPoller');
  private stopped = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly bot: TelegramBotService,
    private readonly links: TelegramLinkService,
    private readonly redis: RedisService,
    private readonly scheduler: SchedulerService,
  ) {}

  onApplicationBootstrap(): void {
    void this.loop();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    const offsetKey = this.redis.key('telegram', 'offset');
    while (!this.stopped) {
      try {
        const s = await this.settings.get('telegram');
        if (!this.scheduler.isLeader || !s.enabled || s.mode !== 'POLLING' || !(await this.bot.isConfigured())) {
          await sleep(10_000);
          continue;
        }
        const offset = Number((await this.redis.client.get(offsetKey)) ?? '0');
        const updates = await this.bot.getUpdates(offset, 25);
        for (const u of updates) {
          await this.links.handleUpdate(u).catch((err) => this.logger.error('Update handling failed', { err }));
          await this.redis.client.set(offsetKey, String(u.update_id + 1));
        }
      } catch (err) {
        this.logger.warn('Telegram polling error', { err: String(err) });
        await sleep(5_000);
      }
    }
  }
}
