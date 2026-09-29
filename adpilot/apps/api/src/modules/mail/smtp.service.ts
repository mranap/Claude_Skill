import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SettingsService } from '../settings/settings.service';
import { AppError } from '../../common/errors/app-error';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SmtpFailureKind = 'NOT_CONFIGURED' | 'TEMPORARY' | 'PERMANENT' | 'AMBIGUOUS';

export class SmtpSendError extends Error {
  constructor(
    readonly kind: SmtpFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'SmtpSendError';
  }
}

/** Sends e-mail through the SMTP server configured by the Super Admin (settings group "smtp"). */
@Injectable()
export class SmtpService {
  constructor(private readonly settings: SettingsService) {}

  private async transport(): Promise<{ transporter: Transporter; from: string }> {
    const smtp = await this.settings.get('smtp');
    if (!smtp.enabled || !smtp.host || !smtp.fromEmail) {
      throw new SmtpSendError('NOT_CONFIGURED', 'SMTP is not configured');
    }
    const password = await this.settings.getSecret('smtp', 'password');
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.encryption === 'SSL',
      requireTLS: smtp.encryption === 'STARTTLS',
      ignoreTLS: smtp.encryption === 'NONE',
      auth: smtp.username ? { user: smtp.username, pass: password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    const fromName = smtp.fromName.replace(/["\r\n]/g, '');
    return { transporter, from: `"${fromName}" <${smtp.fromEmail}>` };
  }

  async send(mail: OutgoingEmail): Promise<{ messageId: string }> {
    let prepared: { transporter: Transporter; from: string };
    try {
      prepared = await this.transport();
    } catch (err) {
      // The settings could not be loaded (e.g. database unavailable): nothing was sent, try again later.
      throw err instanceof SmtpSendError
        ? err
        : new SmtpSendError('TEMPORARY', `SMTP settings unavailable: ${(err as Error).message}`);
    }
    const { transporter, from } = prepared;
    try {
      const info = await transporter.sendMail({
        from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      return { messageId: String(info.messageId ?? '') };
    } catch (err) {
      throw classifySmtpError(err);
    } finally {
      transporter.close();
    }
  }

  /** Used by the admin "Test connection" button. */
  async verify(): Promise<void> {
    const { transporter } = await this.transport();
    try {
      await transporter.verify();
    } catch (err) {
      throw new AppError('BAD_REQUEST', `SMTP connection failed: ${(err as Error).message}`);
    } finally {
      transporter.close();
    }
  }
}

export function classifySmtpError(err: unknown): SmtpSendError {
  const e = err as { responseCode?: number; code?: string; command?: string; message?: string };
  const message = e?.message ?? 'SMTP error';
  if (typeof e?.responseCode === 'number') {
    if (e.responseCode >= 500) return new SmtpSendError('PERMANENT', message);
    if (e.responseCode >= 400) return new SmtpSendError('TEMPORARY', message);
  }
  // Connection problems before the DATA phase: the message was certainly not accepted.
  if (
    ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNECTION', 'EDNS', 'ETLS', 'EAUTH'].includes(e?.code ?? '')
  ) {
    return new SmtpSendError(e.code === 'EAUTH' ? 'PERMANENT' : 'TEMPORARY', message);
  }
  if (e?.code === 'ETIMEDOUT' && e.command && e.command !== 'DATA' && e.command !== 'DATA_END') {
    return new SmtpSendError('TEMPORARY', message);
  }
  // Timeout/socket errors during or after DATA: the server may have accepted the message.
  return new SmtpSendError('AMBIGUOUS', message);
}
