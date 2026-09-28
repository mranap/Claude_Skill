import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EmailJob, QUEUES, type SystemEmail } from '../../infra/queue/queues';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { SmtpSendError, SmtpService } from '../../modules/mail/smtp.service';
import { MailTemplates } from '../../modules/mail/mail-templates';
import { DeliveryService } from '../../modules/notifications/delivery.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { SystemLogService } from '../../modules/system-log/system-log.service';
import { QueueProcessor } from '../processor';
import { UnrecoverableError } from '../job-errors';

/** EMAIL_SEND: system e-mails and notification deliveries. */
@Injectable()
export class EmailProcessor implements QueueProcessor {
  readonly queue = QUEUES.EMAIL;

  constructor(
    private readonly smtp: SmtpService,
    private readonly deliveries: DeliveryService,
    private readonly settings: SettingsService,
    private readonly systemLog: SystemLogService,
    private readonly encryption: EncryptionService,
  ) {}

  async process(job: Job<EmailJob>): Promise<unknown> {
    const data = job.data;
    if (data.kind === 'system') return this.sendSystem(job, data);
    if (data.kind === 'sealed') {
      let message: SystemEmail;
      try {
        message = JSON.parse(this.encryption.decrypt(data.sealed, Aad.mailJob())) as SystemEmail;
      } catch (err) {
        // Deterministic (unknown key or damaged envelope): retrying cannot help.
        await this.systemLog.error(
          'email',
          `System e-mail "${data.tag}" not sent: the sealed message cannot be opened (${(err as Error).message})`,
          { tag: data.tag },
          data.userId,
        );
        throw new UnrecoverableError('Sealed e-mail cannot be decrypted');
      }
      return this.sendSystem(job, { kind: 'system', ...message, tag: data.tag, userId: data.userId });
    }
    return this.sendDelivery(job, data.deliveryId);
  }

  private async sendSystem(job: Job, data: Extract<EmailJob, { kind: 'system' }>) {
    try {
      const res = await this.smtp.send({
        to: data.to,
        subject: data.subject,
        html: data.html,
        text: data.text,
      });
      return { messageId: res.messageId };
    } catch (err) {
      const e = err instanceof SmtpSendError ? err : new SmtpSendError('TEMPORARY', (err as Error).message);
      if (e.kind === 'TEMPORARY') throw e;
      await this.systemLog.error(
        'email',
        `System e-mail "${data.tag}" not sent: ${e.message}`,
        { kind: e.kind, tag: data.tag },
        data.userId,
      );
      throw new UnrecoverableError(e.message);
    }
  }

  private async sendDelivery(job: Job, deliveryId: string) {
    // Loaded before the claim: a failure here leaves the delivery PENDING for the retry.
    const { platformName } = await this.settings.get('general');
    const d = await this.deliveries.claim(deliveryId);
    if (!d) return { skipped: 'already processed' };
    const user = d.notification.user;
    if (user.status !== 'ACTIVE') {
      await this.deliveries.markFinal(deliveryId, 'SKIPPED', 'User is not active');
      return { skipped: 'inactive user' };
    }
    try {
      const email = MailTemplates.notification(
        platformName,
        d.notification.title,
        d.notification.body,
        this.deliveries.absoluteLink(d.notification.link),
      );
      await this.smtp.send({ to: user.email, ...email });
    } catch (err) {
      // Only an SMTP error can mean "maybe sent"; anything else failed before the message left.
      const e = err instanceof SmtpSendError ? err : new SmtpSendError('TEMPORARY', (err as Error).message);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (e.kind === 'TEMPORARY' && !lastAttempt) {
        await this.deliveries.release(deliveryId, e.message);
        throw e;
      }
      const status =
        e.kind === 'AMBIGUOUS' ? 'UNCERTAIN' : e.kind === 'NOT_CONFIGURED' ? 'SKIPPED' : 'FAILED';
      await this.deliveries.markFinal(deliveryId, status, e.message);
      if (status !== 'SKIPPED')
        await this.systemLog.warn(
          'email',
          `Notification e-mail ${status.toLowerCase()}: ${e.message}`,
          { deliveryId },
          user.id,
        );
      return { status };
    }
    // Outside the try: the message is out, so a failure to record it must never be treated as a send failure.
    await this.deliveries.markSent(deliveryId);
    return { sent: true };
  }
}
