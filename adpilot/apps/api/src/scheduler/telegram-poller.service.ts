import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SettingsService } from '../modules/settings/settings.service';
import { TelegramBotService, type TelegramUpdate } from '../modules/telegram/telegram-bot.service';
import { TelegramLinkService } from '../modules/telegram/telegram-link.service';
import { RedisService } from '../infra/redis/redis.service';
import { AppLogger } from '../infra/logger/logger';
import { SchedulerService } from './scheduler.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long a handled update id is remembered: as long as Telegram keeps an unconfirmed update (24 h). */
const HANDLED_TTL_S = 24 * 3600;

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
        await this.handleUpdates(await this.bot.getUpdates(offset, 25));
      } catch (err) {
        this.logger.warn('Telegram polling error', { err: String(err) });
        await sleep(5_000);
      }
    }
  }

  /**
   * Handles a batch and moves the offset past it. During a leader hand-over two pollers can receive the same
   * updates (the offset only moves after handling), so each update is handled only by the poller that claims
   * its id first: a `/start` link is never answered twice ("linked" and then "invalid link").
   */
  async handleUpdates(updates: TelegramUpdate[]): Promise<void> {
    const offsetKey = this.redis.key('telegram', 'offset');
    for (const u of updates) {
      const claimed = await this.redis.client.set(this.redis.key('telegram', 'update', u.update_id), '1', 'EX', HANDLED_TTL_S, 'NX');
      if (claimed === 'OK') await this.links.handleUpdate(u).catch((err) => this.logger.error('Update handling failed', { err }));
      await this.redis.client.set(offsetKey, String(u.update_id + 1));
    }
  }
}
