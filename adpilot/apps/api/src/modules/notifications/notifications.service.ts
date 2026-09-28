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

/** A notification written inside a caller's transaction whose deliveries are not queued yet (see notifyInTx). */
export interface PendingNotification {
  notificationId: string;
  created: boolean;
  deliveries: { id: string; channel: 'EMAIL' | 'TELEGRAM' }[];
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
        const n = await tx.notification.create({ data: this.notificationRow(input) });
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
      // A PENDING delivery whose job already failed (e.g. the claim failed on every attempt) must run again.
      if (channel === 'EMAIL') {
        await this.queue.addReplacingFinished(
          QUEUES.EMAIL,
          JOBS.EMAIL_SEND,
          { kind: 'delivery', deliveryId },
          { jobId: jobId('delivery', deliveryId) },
        );
      } else {
        await this.queue.addReplacingFinished(
          QUEUES.TELEGRAM,
          JOBS.TELEGRAM_SEND,
          { kind: 'delivery', deliveryId },
          { jobId: jobId('delivery', deliveryId) },
        );
      }
    } catch (err) {
      // The outbox sweep (scheduler) retries PENDING deliveries whose job could not be queued.
      this.logger.warn('Could not enqueue delivery; the outbox sweep will retry', {
        deliveryId,
        err: String(err),
      });
    }
  }

  async channelsFor(
    userId: string,
    type: NotificationType,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<('EMAIL' | 'TELEGRAM')[]> {
    const pref = await db.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
      select: { channel: true },
    });
    const channel: NotificationChannelPref = pref?.channel ?? DEFAULT_NOTIFICATION_PREFS[type];
    const out: ('EMAIL' | 'TELEGRAM')[] = [];
    if (channel === 'EMAIL' || channel === 'BOTH') out.push('EMAIL');
    if (channel === 'TELEGRAM' || channel === 'BOTH') {
      const tg = await db.telegramConnection.findUnique({ where: { userId }, select: { isActive: true } });
      if (tg?.isActive) out.push('TELEGRAM');
    }
    return out;
  }

  /**
   * notify() inside the caller's transaction: the notification and its delivery rows commit or roll back with
   * the state change they report, so a crash or a failed insert can no longer lose the alert while the change
   * stays (a retry then sees the change as already recorded). Pass the result to dispatch() once the
   * transaction committed; deliveries that never get queued (the process died in between) are picked up by the
   * outbox sweep. A duplicate dedupeKey is skipped without aborting the transaction.
   */
  async notifyInTx(tx: Prisma.TransactionClient, input: NotifyInput): Promise<PendingNotification> {
    const channels = input.channels ?? (await this.channelsFor(input.userId, input.type, tx));
    const [n] = await tx.notification.createManyAndReturn({
      data: [this.notificationRow(input)],
      skipDuplicates: true,
      select: { id: true },
    });
    if (!n) {
      const existing = input.dedupeKey
        ? await tx.notification.findUnique({
            where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
            select: { id: true },
          })
        : null;
      return { notificationId: existing?.id ?? '', created: false, deliveries: [] };
    }
    const deliveries = channels.length
      ? await tx.notificationDelivery.createManyAndReturn({
          data: channels.map((channel) => ({ notificationId: n.id, userId: input.userId, channel })),
          select: { id: true, channel: true },
        })
      : [];
    return { notificationId: n.id, created: true, deliveries };
  }

  /** Queues the deliveries of a notification written with notifyInTx(), after its transaction committed. */
  async dispatch(pending: PendingNotification): Promise<void> {
    for (const d of pending.deliveries) await this.enqueueDelivery(d.id, d.channel);
  }

  private notificationRow(input: NotifyInput): Prisma.NotificationUncheckedCreateInput {
    return {
      userId: input.userId,
      type: input.type,
      severity: input.severity ?? 'INFO',
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 4000),
      link: input.link ?? null,
      data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      dedupeKey: input.dedupeKey ?? null,
      showInApp: input.inApp ?? true,
    };
  }

  async getPreferences(
    userId: string,
  ): Promise<{ type: NotificationType; channel: NotificationChannelPref }[]> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const map = new Map(rows.map((r) => [r.type, r.channel]));
    return NOTIFICATION_TYPES.map((type) => ({
      type,
      channel: map.get(type) ?? DEFAULT_NOTIFICATION_PREFS[type],
    }));
  }

  async setPreferences(
    userId: string,
    prefs: { type: NotificationType; channel: NotificationChannelPref }[],
  ): Promise<void> {
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
