import { Global, Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

@Global()
@Module({
  controllers: [TelegramWebhookController],
  providers: [TelegramBotService, TelegramLinkService],
  exports: [TelegramBotService, TelegramLinkService],
})
export class TelegramModule {}
