import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  SECRET_SETTING_FIELDS,
  SETTING_KEYS,
  SETTING_PERMISSIONS,
  hasPermission,
  type PermissionKey,
  type SettingKey,
} from '@adpilot/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AppError } from '../../common/errors/app-error';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { SmtpService } from '../mail/smtp.service';
import { MailTemplates } from '../mail/mail-templates';
import { TelegramBotService, tgEscape } from '../telegram/telegram-bot.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MetaConnectivityService } from '../meta/meta-connectivity.service';
import type { AuthUser } from '../auth/auth.types';

const updateSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
  /** Secret fields: omit to keep, null to clear, string to replace. */
  secrets: z.record(z.string(), z.string().max(4096).nullable()).default({}),
});

const smtpTestSchema = z.object({ to: z.email().optional() });

@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly smtp: SmtpService,
    private readonly telegram: TelegramBotService,
    private readonly hashing: HashingService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly metaConnectivity: MetaConnectivityService,
  ) {}

  @Get()
  @RequirePermissions('admin.settings.view')
  async all() {
    const out: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) out[key] = await this.settings.getForAdmin(key);
    out.environment = {
      metaGraphApiVersion: this.config.env.META_GRAPH_API_VERSION,
      appUrl: this.config.appUrl,
      nodeEnv: this.config.env.NODE_ENV,
      storageBucket: this.config.env.S3_BUCKET,
      storageEndpoint: this.config.env.S3_ENDPOINT ?? 'AWS S3',
      telegramWebhookUrl: `${this.config.appUrl}/api/telegram/webhook`,
    };
    return out;
  }

  @Get(':key')
  @RequirePermissions('admin.settings.view')
  async one(@Param('key') key: string) {
    return this.settings.getForAdmin(this.assertKey(key));
  }

  @Put(':key')
  @RequirePermissions('admin.settings.view')
  async update(@CurrentUser() user: AuthUser, @Param('key') rawKey: string, @Body(zod(updateSchema)) body: z.infer<typeof updateSchema>) {
    const key = this.assertKey(rawKey);
    if (!hasPermission(user.roleKey, user.permissions, SETTING_PERMISSIONS[key] as PermissionKey)) throw AppError.forbidden();
    const allowedSecrets = SECRET_SETTING_FIELDS[key] ?? [];
    const unknownSecret = Object.keys(body.secrets).find((f) => !allowedSecrets.includes(f));
    if (unknownSecret) throw AppError.validation(`Unknown secret field "${unknownSecret}"`);

    const secrets = { ...body.secrets };
    const values = { ...body.values } as Record<string, unknown>;
    if (key === 'telegram') await this.prepareTelegram(values, secrets);

    const updated = await this.settings.update(key, values, secrets, user.id);
    if (key === 'telegram') await this.applyTelegramMode().catch((err: Error) => {
      throw new AppError('BAD_REQUEST', `Settings saved, but the webhook could not be configured: ${err.message}`);
    });
    await this.audit.log({
      action: 'admin.settings.updated',
      actorUserId: user.id,
      targetType: 'setting',
      targetId: key,
      metadata: { values, secretsChanged: Object.keys(secrets) },
    });
    return { ...(await this.settings.getForAdmin(key)), _saved: !!updated };
  }

  @Post('smtp/verify')
  @HttpCode(200)
  @RequirePermissions('admin.smtp.manage')
  async verifySmtp() {
    await this.smtp.verify();
    return { ok: true };
  }

  /** Sends the test e-mail synchronously so the administrator sees the SMTP error immediately. */
  @Post('smtp/test')
  @HttpCode(200)
  @RequirePermissions('admin.smtp.manage')
  async testSmtp(@CurrentUser() user: AuthUser, @Body(zod(smtpTestSchema)) body: z.infer<typeof smtpTestSchema>) {
    const to = body.to ?? user.email;
    const platformName = (await this.settings.get('general')).platformName;
    try {
      const res = await this.smtp.send({ to, ...MailTemplates.test(platformName) });
      await this.audit.log({ action: 'admin.smtp.test_sent', actorUserId: user.id, metadata: { to } });
      return { ok: true, messageId: res.messageId };
    } catch (err) {
      throw new AppError('BAD_REQUEST', `Sending failed: ${(err as Error).message}`);
    }
  }

  @Post('telegram/test')
  @HttpCode(200)
  @RequirePermissions('admin.telegram.manage')
  async testTelegram(@CurrentUser() user: AuthUser) {
    const me = await this.telegram.getMe().catch((err: Error) => {
      throw new AppError('BAD_REQUEST', `Telegram API error: ${err.message}`);
    });
    const conn = await this.prisma.telegramConnection.findUnique({ where: { userId: user.id } });
    let sentToYou = false;
    if (conn?.isActive) {
      await this.telegram.sendMessage(conn.chatId, `✅ <b>${tgEscape(me.first_name)}</b> is configured correctly.`);
      sentToYou = true;
    }
    const webhook = await this.telegram.getWebhookInfo().catch(() => null);
    return { ok: true, bot: { id: me.id, username: me.username }, sentToYou, webhook };
  }

  @Post('meta/test')
  @HttpCode(200)
  @RequirePermissions('admin.meta.manage')
  async testMeta() {
    return this.metaConnectivity.check();
  }

  private assertKey(key: string): SettingKey {
    if (!SETTING_KEYS.includes(key as SettingKey)) throw AppError.notFound('Setting group');
    return key as SettingKey;
  }

  /** Validates a new bot token with getMe and fills in the bot username; creates the webhook secret. */
  private async prepareTelegram(values: Record<string, unknown>, secrets: Record<string, string | null>) {
    // The webhook secret is generated by the platform, never supplied by the browser.
    delete secrets.webhookSecret;
    const newToken = secrets.botToken;
    if (typeof newToken === 'string' && newToken) {
      if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(newToken)) throw AppError.validation('This does not look like a bot token');
      const me = await this.telegram.getMe(newToken).catch(() => {
        throw AppError.validation('Telegram rejected this bot token');
      });
      values.botUsername = me.username;
    }
    if (values.mode === 'WEBHOOK' && !(await this.settings.getSecret('telegram', 'webhookSecret'))) {
      secrets.webhookSecret = this.hashing.randomToken(32);
    }
  }

  private async applyTelegramMode(): Promise<void> {
    const s = await this.settings.get('telegram');
    if (!s.enabled) return;
    if (s.mode === 'WEBHOOK') {
      const secret = await this.settings.getSecret('telegram', 'webhookSecret');
      if (!secret) throw new Error('Webhook secret missing');
      if (!this.config.appUrl.startsWith('https://')) throw new Error('Webhook mode requires APP_URL with https://');
      await this.telegram.setWebhook(`${this.config.appUrl}/api/telegram/webhook`, secret);
    } else {
      await this.telegram.deleteWebhook();
    }
  }
}
