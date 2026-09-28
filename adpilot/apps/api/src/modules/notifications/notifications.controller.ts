import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { NOTIFICATION_CHANNEL_PREFS, NOTIFICATION_TYPES, paginationQuerySchema } from '@adpilot/shared';
import { z } from 'zod';
import { CurrentUser, RateLimit } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { TelegramLinkService } from '../telegram/telegram-link.service';
import { NotificationsService } from './notifications.service';
import type { AuthUser } from '../auth/auth.types';

const listSchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const preferencesSchema = z.object({
  preferences: z
    .array(z.object({ type: z.enum(NOTIFICATION_TYPES), channel: z.enum(NOTIFICATION_CHANNEL_PREFS) }))
    .min(1)
    .max(NOTIFICATION_TYPES.length),
});

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramLinkService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    const where = { userId: user.id, showInApp: true, ...(q.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          body: true,
          link: true,
          data: true,
          readAt: true,
          createdAt: true,
          deliveries: { select: { channel: true, status: true, sentAt: true } },
        },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, showInApp: true, readAt: null } }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, unread };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { unread: await this.prisma.notification.count({ where: { userId: user.id, showInApp: true, readAt: null } }) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (res.count === 0 && !(await this.prisma.notification.findFirst({ where: { id, userId: user.id }, select: { id: true } }))) {
      throw AppError.notFound('Notification');
    }
    return { ok: true };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: AuthUser) {
    const res = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.id);
  }

  @Put('preferences')
  async setPreferences(@CurrentUser() user: AuthUser, @Body(zod(preferencesSchema)) body: z.infer<typeof preferencesSchema>) {
    await this.notifications.setPreferences(user.id, body.preferences);
    return this.notifications.getPreferences(user.id);
  }

  @Post('test')
  @HttpCode(202)
  @RateLimit({ bucket: 'notification-test', limit: 3, windowSeconds: 600 })
  async test(@CurrentUser() user: AuthUser) {
    const { notificationId } = await this.notifications.notify({
      userId: user.id,
      type: 'SYSTEM_MESSAGE',
      severity: 'INFO',
      title: 'Test notification',
      body: 'This is a test notification. If you see it in Telegram or e-mail, your delivery settings work.',
    });
    return { notificationId };
  }

  @Get('telegram')
  telegramStatus(@CurrentUser() user: AuthUser) {
    return this.telegram.status(user.id);
  }

  @Post('telegram/link')
  @HttpCode(200)
  @RateLimit({ bucket: 'telegram-link', limit: 10, windowSeconds: 3600 })
  telegramLink(@CurrentUser() user: AuthUser) {
    return this.telegram.createLink(user.id);
  }

  @Delete('telegram')
  async telegramUnlink(@CurrentUser() user: AuthUser) {
    await this.telegram.unlink(user.id);
    return { ok: true };
  }
}
