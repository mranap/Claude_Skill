import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../../infra/logger/logger';
import { TelegramBotService, TelegramUpdate, assertTelegramConfigured, tgEscape } from './telegram-bot.service';

const LINK_TTL_MS = 10 * 60_000;

/**
 * Secure Telegram linking: the user gets a one-time deep link `t.me/<bot>?start=<code>` (10 minutes,
 * single use, only the hash is stored). The chat that sends `/start <code>` to the bot becomes the user's
 * notification chat, so nobody can attach a foreign Telegram account without access to the user's session.
 */
@Injectable()
export class TelegramLinkService {
  private readonly logger = new AppLogger('TelegramLink');

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly settings: SettingsService,
    private readonly bot: TelegramBotService,
    private readonly audit: AuditService,
  ) {}

  async createLink(userId: string): Promise<{ url: string; expiresAt: Date; botUsername: string }> {
    assertTelegramConfigured(await this.bot.isConfigured());
    const { botUsername } = await this.settings.get('telegram');
    const code = this.hashing.randomToken(24); // 32 url-safe chars (Telegram allows up to 64)
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.telegramLinkCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.telegramLinkCode.create({ data: { userId, codeHash: this.hashing.sha256(code), expiresAt } }),
    ]);
    return { url: `https://t.me/${botUsername}?start=${code}`, expiresAt, botUsername };
  }

  async status(userId: string) {
    const conn = await this.prisma.telegramConnection.findUnique({ where: { userId } });
    const s = await this.settings.get('telegram');
    return {
      botConfigured: await this.bot.isConfigured(),
      botUsername: s.botUsername || null,
      connected: !!conn?.isActive,
      username: conn?.username ?? null,
      firstName: conn?.firstName ?? null,
      linkedAt: conn?.linkedAt ?? null,
      lastError: conn?.lastError ?? null,
    };
  }

  async unlink(userId: string): Promise<void> {
    await this.prisma.telegramConnection.deleteMany({ where: { userId } });
    await this.audit.log({ action: 'telegram.unlinked', actorUserId: userId, subjectUserId: userId });
  }

  /** Handles one update from the webhook or the long-polling loop. */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text || msg.chat.type !== 'private' || msg.from?.is_bot) return;
    const text = msg.text.trim();
    const chatId = String(msg.chat.id);

    if (!text.startsWith('/start')) {
      await this.reply(chatId, 'This bot only sends notifications from the ads platform. Open Settings → Notifications on the website to link your account.');
      return;
    }
    const code = text.split(/\s+/)[1];
    if (!code) {
      await this.reply(chatId, 'Hi! To receive notifications, open Settings → Notifications on the website and press “Connect Telegram”.');
      return;
    }

    const codeHash = this.hashing.sha256(code);
    const linked = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.telegramLinkCode.updateMany({
        where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return null;
      const row = await tx.telegramLinkCode.findUniqueOrThrow({ where: { codeHash } });
      const user = await tx.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true, status: true } });
      if (!user || user.status !== 'ACTIVE') return null;
      await tx.telegramConnection.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          chatId,
          username: msg.from?.username ?? msg.chat.username ?? null,
          firstName: msg.from?.first_name ?? msg.chat.first_name ?? null,
          isActive: true,
        },
        update: {
          chatId,
          username: msg.from?.username ?? msg.chat.username ?? null,
          firstName: msg.from?.first_name ?? msg.chat.first_name ?? null,
          isActive: true,
          lastError: null,
          linkedAt: new Date(),
        },
      });
      return user;
    });

    if (!linked) {
      await this.reply(chatId, 'This link is invalid or has expired. Generate a new one in Settings → Notifications.');
      return;
    }
    await this.audit.log({
      action: 'telegram.linked',
      actorUserId: linked.id,
      subjectUserId: linked.id,
      metadata: { username: msg.from?.username ?? null },
    });
    const masked = linked.email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
    await this.reply(chatId, `✅ Telegram is now linked to <b>${tgEscape(masked)}</b>. You will receive notifications here.`);
  }

  private async reply(chatId: string, html: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, html);
    } catch (err) {
      this.logger.warn('Failed to reply to Telegram user', { err: String(err) });
    }
  }
}
