import { Injectable } from '@nestjs/common';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_TYPES,
  type NotificationChannelPref,
  type NotificationSeverity,
  type NotificationType,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { AppLogger } from '../../infra/logger/logger';
import { isUniqueViolation } from '../../infra/prisma/prisma-errors';
import { Prisma } from '../../generated/prisma/client';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  link?: string;
  data?: Record<string, unknown>;
  /**
   * Idempotency key: a second notify() with the same key for the same user is ignored, so a retried job or
   * two concurrent workers can never produce two notifications (or two Telegram messages) for one event.
   */
  dedupeKey?: string;
  /** Overrides user preferences (used by administrator broadcasts). */
  channels?: ('EMAIL' | 'TELEGRAM')[];
  /** false = external channels only; the notification is not listed in the in-app center (default true). */
  inApp?: boolean;
}

/**
 * Every notification is stored in the in-app Notification Center first (always, regardless of channel
 * preferences), then one delivery row per external channel is created and processed by the EMAIL/TELEGRAM
 * queues. Delivery rows are the outbox: the scheduler re-enqueues deliveries whose job got lost.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new AppLogger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async notify(input: NotifyInput): Promise<{ notificationId: string; created: boolean }> {
    const channels = input.channels ?? (await this.channelsFor(input.userId, input.type));
    let notificationId: string;
    let deliveryIds: { id: string; channel: 'EMAIL' | 'TELEGRAM' }[] = [];
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const n = await tx.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            severity: input.severity ?? 'INFO',
            title: input.title.slice(0, 200),
            body: input.body.slice(0, 4000),
            link: input.link ?? null,
            data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
            dedupeKey: input.dedupeKey ?? null,
            showInApp: input.inApp ?? true,
          },
        });
        const deliveries = [];
        for (const channel of channels) {
          deliveries.push(
            await tx.notificationDelivery.create({
              data: { notificationId: n.id, userId: input.userId, channel },
              select: { id: true, channel: true },
            }),
          );
        }
        return { id: n.id, deliveries };
      });
      notificationId = result.id;
      deliveryIds = result.deliveries;
    } catch (err) {
      if (input.dedupeKey && isUniqueViolation(err)) {
        const existing = await this.prisma.notification.findUnique({
          where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
          select: { id: true },
        });
        return { notificationId: existing?.id ?? '', created: false };
      }
      throw err;
    }
    for (const d of deliveryIds) await this.enqueueDelivery(d.id, d.channel);
    return { notificationId, created: true };
  }

  async enqueueDelivery(deliveryId: string, channel: 'EMAIL' | 'TELEGRAM'): Promise<void> {
    try {
      if (channel === 'EMAIL') {
        await this.queue.add(QUEUES.EMAIL, JOBS.EMAIL_SEND, { kind: 'delivery', deliveryId }, { jobId: jobId('delivery', deliveryId) });
      } else {
        await this.queue.add(QUEUES.TELEGRAM, JOBS.TELEGRAM_SEND, { kind: 'delivery', deliveryId }, { jobId: jobId('delivery', deliveryId) });
      }
    } catch (err) {
      // The outbox sweep (scheduler) retries PENDING deliveries whose job could not be queued.
      this.logger.warn('Could not enqueue delivery; the outbox sweep will retry', { deliveryId, err: String(err) });
    }
  }

  async channelsFor(userId: string, type: NotificationType): Promise<('EMAIL' | 'TELEGRAM')[]> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
      select: { channel: true },
    });
    const channel: NotificationChannelPref = pref?.channel ?? DEFAULT_NOTIFICATION_PREFS[type];
    const out: ('EMAIL' | 'TELEGRAM')[] = [];
    if (channel === 'EMAIL' || channel === 'BOTH') out.push('EMAIL');
    if (channel === 'TELEGRAM' || channel === 'BOTH') {
      const tg = await this.prisma.telegramConnection.findUnique({ where: { userId }, select: { isActive: true } });
      if (tg?.isActive) out.push('TELEGRAM');
    }
    return out;
  }

  async getPreferences(userId: string): Promise<{ type: NotificationType; channel: NotificationChannelPref }[]> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const map = new Map(rows.map((r) => [r.type, r.channel]));
    return NOTIFICATION_TYPES.map((type) => ({ type, channel: map.get(type) ?? DEFAULT_NOTIFICATION_PREFS[type] }));
  }

  async setPreferences(userId: string, prefs: { type: NotificationType; channel: NotificationChannelPref }[]): Promise<void> {
    await this.prisma.$transaction(
      prefs.map((p) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: p.type } },
          create: { userId, type: p.type, channel: p.channel },
          update: { channel: p.channel },
        }),
      ),
    );
  }
}
