import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { broadcastSchema } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../infra/logger/logger';
import type { AuthUser } from '../auth/auth.types';

/**
 * Administrator messages to platform users only (never to arbitrary addresses): the audience is resolved
 * from the users table, blocked/deleted users are skipped, and every recipient gets one notification
 * (deduplicated by broadcast id), so a retried job never sends the same message twice.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new AppLogger('Broadcast');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(actor: AuthUser, input: z.infer<typeof broadcastSchema>) {
    if (!input.channels.length && !input.inApp) throw AppError.validation('Select at least one channel');
    if (input.audience === 'SELECTED' && !input.userIds.length)
      throw AppError.validation('Select at least one user');
    const broadcast = await this.prisma.broadcast.create({
      data: {
        createdById: actor.id,
        subject: input.subject,
        body: input.body,
        channels: input.channels,
        inApp: input.inApp,
        audience: input.audience,
        userIds: input.audience === 'SELECTED' ? input.userIds : [],
      },
    });
    await this.queue.add(
      QUEUES.MAINTENANCE,
      JOBS.BROADCAST,
      { broadcastId: broadcast.id },
      { jobId: jobId('broadcast', broadcast.id), attempts: 3 },
    );
    await this.audit.log({
      action: 'admin.broadcast.created',
      actorUserId: actor.id,
      targetType: 'broadcast',
      targetId: broadcast.id,
      metadata: {
        subject: input.subject,
        channels: input.channels,
        audience: input.audience,
        recipients: input.userIds.length,
      },
    });
    return broadcast;
  }

  async list(page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.prisma.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.broadcast.count(),
    ]);
    return { items, total, page, pageSize };
  }

  /** Worker side: fan out to recipients in batches. */
  async process(broadcastId: string): Promise<void> {
    const b = await this.prisma.broadcast.findUnique({ where: { id: broadcastId } });
    if (!b || b.status === 'SUCCESS') return;
    await this.prisma.broadcast.update({ where: { id: b.id }, data: { status: 'RUNNING' } });
    const where = {
      status: 'ACTIVE' as const,
      ...(b.audience === 'SELECTED' ? { id: { in: b.userIds } } : {}),
    };
    let cursor: string | undefined;
    let count = 0;
    try {
      for (;;) {
        const users = await this.prisma.user.findMany({
          where,
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 200,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (!users.length) break;
        for (const u of users) {
          await this.notifications.notify({
            userId: u.id,
            type: 'SYSTEM_MESSAGE',
            severity: 'INFO',
            title: b.subject,
            body: b.body,
            dedupeKey: `broadcast:${b.id}`,
            channels: b.channels,
            inApp: b.inApp,
          });
          count++;
        }
        cursor = users[users.length - 1].id;
      }
      await this.prisma.broadcast.update({
        where: { id: b.id },
        data: { status: 'SUCCESS', recipientCount: count, completedAt: new Date() },
      });
    } catch (err) {
      this.logger.error('Broadcast failed', { err, broadcastId });
      await this.prisma.broadcast.update({
        where: { id: b.id },
        data: { status: 'FAILED', error: String(err), recipientCount: count },
      });
      throw err;
    }
  }
}
