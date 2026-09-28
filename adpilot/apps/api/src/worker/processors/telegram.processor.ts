import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, TelegramJob } from '../../infra/queue/queues';
import { TelegramBotService, TelegramSendError, tgEscape } from '../../modules/telegram/telegram-bot.service';
import { DeliveryService } from '../../modules/notifications/delivery.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SystemLogService } from '../../modules/system-log/system-log.service';
import { QueueProcessor } from '../processor';
import { UnrecoverableError, deferJob } from '../job-errors';

const SEVERITY_ICON: Record<string, string> = { INFO: 'ℹ️', SUCCESS: '✅', WARNING: '⚠️', ERROR: '🛑' };

/** TELEGRAM_SEND: notification deliveries to the user's linked chat. */
@Injectable()
export class TelegramProcessor implements QueueProcessor {
  readonly queue = QUEUES.TELEGRAM;

  constructor(
    private readonly bot: TelegramBotService,
    private readonly deliveries: DeliveryService,
    private readonly prisma: PrismaService,
    private readonly systemLog: SystemLogService,
  ) {}

  async process(job: Job<TelegramJob>, token?: string): Promise<unknown> {
    const data = job.data;
    if (data.kind === 'direct') {
      await this.bot.sendMessage(data.chatId, data.text);
      return { sent: true };
    }
    const deliveryId = data.deliveryId;
    const d = await this.deliveries.claim(deliveryId);
    if (!d) return { skipped: 'already processed' };
    const user = d.notification.user;
    const conn = user.telegramConnection;
    if (user.status !== 'ACTIVE' || !conn?.isActive) {
      await this.deliveries.markFinal(deliveryId, 'SKIPPED', 'Telegram is not linked');
      return { skipped: 'not linked' };
    }
    const n = d.notification;
    try {
      const link = this.deliveries.absoluteLink(n.link);
      const text =
        `${SEVERITY_ICON[n.severity] ?? ''} <b>${tgEscape(n.title)}</b>\n\n${tgEscape(n.body)}` +
        (link ? `\n\n<a href="${tgEscape(link)}">Open in AdPilot</a>` : '');
      await this.bot.sendMessage(conn.chatId, text);
    } catch (err) {
      // Only a Bot API error can mean "maybe sent"; anything else failed before the message left.
      const e = err instanceof TelegramSendError ? err : new TelegramSendError('TEMPORARY', (err as Error).message);
      if (e.kind === 'RATE_LIMITED') {
        // Definitely not delivered: release and retry after Telegram's retry_after.
        await this.deliveries.release(deliveryId, e.message);
        return deferJob(job, token, (e.retryAfterSeconds ?? 30) * 1000 + 500);
      }
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (e.kind === 'TEMPORARY' && !lastAttempt) {
        await this.deliveries.release(deliveryId, e.message);
        throw e;
      }
      if (e.kind === 'CHAT_UNAVAILABLE') {
        await this.prisma.telegramConnection.update({ where: { userId: user.id }, data: { isActive: false, lastError: e.message } });
      }
      const status = e.kind === 'AMBIGUOUS' ? 'UNCERTAIN' : e.kind === 'NOT_CONFIGURED' ? 'SKIPPED' : 'FAILED';
      await this.deliveries.markFinal(deliveryId, status, e.message);
      if (status === 'FAILED') await this.systemLog.warn('telegram', `Telegram delivery failed: ${e.message}`, { deliveryId }, user.id);
      if (status === 'FAILED' && e.kind === 'PERMANENT') throw new UnrecoverableError(e.message);
      return { status };
    }
    // Outside the try: the message is out, so a failure to record it must never be treated as a send failure.
    await this.deliveries.markSent(deliveryId);
    return { sent: true };
  }
}
