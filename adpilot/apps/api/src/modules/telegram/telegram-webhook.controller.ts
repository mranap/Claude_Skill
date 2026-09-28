import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Public, SkipCsrf } from '../../common/decorators/auth.decorators';
import { SettingsService } from '../settings/settings.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../infra/logger/logger';
import { TelegramLinkService } from './telegram-link.service';
import type { TelegramUpdate } from './telegram-bot.service';

/**
 * Telegram webhook (only used in WEBHOOK mode). Authenticated with the secret token Telegram echoes in
 * the `X-Telegram-Bot-Api-Secret-Token` header (configured by the platform when the webhook is set).
 */
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new AppLogger('TelegramWebhook');

  constructor(
    private readonly settings: SettingsService,
    private readonly hashing: HashingService,
    private readonly links: TelegramLinkService,
  ) {}

  @Public()
  @SkipCsrf()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    const s = await this.settings.get('telegram');
    const secret = await this.settings.getSecret('telegram', 'webhookSecret');
    if (
      !s.enabled ||
      s.mode !== 'WEBHOOK' ||
      !secret ||
      !secretHeader ||
      !this.hashing.safeEqual(secret, secretHeader)
    ) {
      throw AppError.forbidden('Invalid webhook secret');
    }
    try {
      await this.links.handleUpdate(update);
    } catch (err) {
      // Always acknowledge so Telegram does not redeliver endlessly; the error is logged.
      this.logger.error('Failed to process Telegram update', { err });
    }
    return { ok: true };
  }
}
