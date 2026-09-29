import { Injectable } from '@nestjs/common';
import { QueueService } from '../../infra/queue/queue.service';
import { EmailJob, JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../settings/settings.service';
import { AppConfig } from '../../config/app-config';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { MailTemplates, RenderedEmail } from './mail-templates';

/**
 * Queues transactional (system) e-mails. Jobs carrying one-time links are removed from Redis as soon as
 * they complete and kept at most one hour when failed.
 */
@Injectable()
export class MailService {
  constructor(
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
    private readonly encryption: EncryptionService,
  ) {}

  async platformName(): Promise<string> {
    return (await this.settings.get('general')).platformName;
  }

  link(path: string): string {
    return `${this.config.appUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async enqueue(
    to: string,
    email: RenderedEmail,
    tag: string,
    opts: { sensitive?: boolean; userId?: string } = {},
  ) {
    const message = { to, subject: email.subject, html: email.html, text: email.text };
    // One-time links must not sit in Redis in clear text: sensitive messages are sealed with the platform key.
    const data: EmailJob = opts.sensitive
      ? {
          kind: 'sealed',
          sealed: this.encryption.encrypt(JSON.stringify(message), Aad.mailJob()),
          tag,
          userId: opts.userId,
        }
      : { kind: 'system', ...message, tag, userId: opts.userId };
    await this.queue.add(QUEUES.EMAIL, JOBS.EMAIL_SEND, data, {
      attempts: 5,
      removeOnComplete: opts.sensitive ? true : { age: 24 * 3600 },
      removeOnFail: opts.sensitive ? { age: 3600 } : { age: 7 * 24 * 3600 },
    });
  }

  async sendInvitation(to: string, token: string, hours: number, userId: string): Promise<void> {
    // One-time tokens travel in the URL fragment: never sent to a server, logged or leaked through Referer.
    const url = this.link(`/reset-password?invite=1#token=${encodeURIComponent(token)}`);
    await this.enqueue(to, MailTemplates.invitation(await this.platformName(), url, hours), 'invitation', {
      sensitive: true,
      userId,
    });
  }

  async sendPasswordReset(to: string, token: string, minutes: number, userId: string): Promise<void> {
    const url = this.link(`/reset-password#token=${encodeURIComponent(token)}`);
    await this.enqueue(
      to,
      MailTemplates.passwordReset(await this.platformName(), url, minutes),
      'password_reset',
      {
        sensitive: true,
        userId,
      },
    );
  }

  async sendEmailChangeConfirmation(to: string, token: string, userId: string): Promise<void> {
    const url = this.link(`/confirm-email#token=${encodeURIComponent(token)}`);
    await this.enqueue(to, MailTemplates.emailChangeConfirm(await this.platformName(), url), 'email_change', {
      sensitive: true,
      userId,
    });
  }

  async sendSecurityNotice(to: string, title: string, message: string, userId?: string): Promise<void> {
    await this.enqueue(
      to,
      MailTemplates.securityNotice(await this.platformName(), title, message),
      'security_notice',
      {
        userId,
      },
    );
  }
}
