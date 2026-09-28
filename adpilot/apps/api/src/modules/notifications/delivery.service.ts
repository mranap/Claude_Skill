import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfig } from '../../config/app-config';

export type ClaimedDelivery = NonNullable<Awaited<ReturnType<DeliveryService['claim']>>>;

/**
 * Delivery state machine (one row per notification × channel):
 *   PENDING → SENDING → SENT
 *                     ↘ PENDING (temporary failure, retried by the queue)
 *                     ↘ FAILED (permanent) / SKIPPED (channel unavailable)
 *                     ↘ UNCERTAIN (timeout after the request was sent — never re-sent to avoid duplicates)
 * `claim` is an atomic compare-and-set, so a duplicated or re-delivered job cannot send twice.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async claim(deliveryId: string) {
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: 'PENDING' },
      data: { status: 'SENDING', claimedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          include: {
            user: { select: { id: true, email: true, status: true, telegramConnection: true } },
          },
        },
      },
    });
  }

  async markSent(deliveryId: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SENT', sentAt: new Date(), lastError: null },
    });
  }

  async markFinal(
    deliveryId: string,
    status: 'FAILED' | 'SKIPPED' | 'UNCERTAIN',
    error: string,
  ): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status, lastError: error.slice(0, 1000) },
    });
  }

  /** Temporary failure: back to PENDING so the queue retry can claim it again. */
  async release(deliveryId: string, error: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', lastError: error.slice(0, 1000) },
    });
  }

  absoluteLink(link: string | null): string | undefined {
    if (!link) return undefined;
    return link.startsWith('http') ? link : `${this.config.appUrl}${link}`;
  }
}
