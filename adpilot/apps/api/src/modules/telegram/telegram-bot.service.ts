import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { SettingsService } from '../settings/settings.service';
import { AppError } from '../../common/errors/app-error';

const API_BASE = 'https://api.telegram.org';

export type TelegramFailureKind = 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'TEMPORARY' | 'PERMANENT' | 'CHAT_UNAVAILABLE' | 'AMBIGUOUS';

export class TelegramSendError extends Error {
  constructor(
    readonly kind: TelegramFailureKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TelegramSendError';
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string; username?: string; first_name?: string };
    from?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
  };
}

/** Thin client for the Telegram Bot API (token from Super Admin settings, stored encrypted). */
@Injectable()
export class TelegramBotService {
  constructor(private readonly settings: SettingsService) {}

  async isConfigured(): Promise<boolean> {
    const s = await this.settings.get('telegram');
    return s.enabled && !!(await this.settings.getSecret('telegram', 'botToken'));
  }

  private async token(): Promise<string> {
    const s = await this.settings.get('telegram');
    const token = await this.settings.getSecret('telegram', 'botToken');
    if (!s.enabled || !token) throw new TelegramSendError('NOT_CONFIGURED', 'Telegram bot is not configured');
    return token;
  }

  async call<T>(method: string, payload: Record<string, unknown> = {}, timeoutMs = 20_000, tokenOverride?: string): Promise<T> {
    const token = tokenOverride ?? (await this.token());
    try {
      const res = await axios.post<{ ok: boolean; result: T; description?: string }>(
        `${API_BASE}/bot${token}/${method}`,
        payload,
        { timeout: timeoutMs, proxy: false },
      );
      return res.data.result;
    } catch (err) {
      throw this.classify(err);
    }
  }

  async getMe(tokenOverride?: string): Promise<{ id: number; username: string; first_name: string }> {
    return this.call('getMe', {}, 10_000, tokenOverride);
  }

  async sendMessage(chatId: string, html: string): Promise<{ message_id: number }> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text: html.slice(0, 4096),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message'], drop_pending_updates: false });
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook', { drop_pending_updates: false });
  }

  async getWebhookInfo(): Promise<{ url: string; pending_update_count: number; last_error_message?: string }> {
    return this.call('getWebhookInfo');
  }

  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    return this.call('getUpdates', { offset, timeout: timeoutSeconds, allowed_updates: ['message'] }, (timeoutSeconds + 10) * 1000);
  }

  private classify(err: unknown): TelegramSendError {
    if (err instanceof TelegramSendError) return err;
    const ax = err as AxiosError<{ description?: string; parameters?: { retry_after?: number } }>;
    const status = ax.response?.status;
    const description = ax.response?.data?.description ?? ax.message;
    if (status === 429) {
      return new TelegramSendError('RATE_LIMITED', description, ax.response?.data?.parameters?.retry_after ?? 30);
    }
    if (status === 403 || (status === 400 && /chat not found|user is deactivated/i.test(description))) {
      return new TelegramSendError('CHAT_UNAVAILABLE', description);
    }
    if (status === 401 || status === 404) return new TelegramSendError('PERMANENT', 'Invalid bot token');
    if (status && status >= 400 && status < 500) return new TelegramSendError('PERMANENT', description);
    if (status && status >= 500) return new TelegramSendError('TEMPORARY', description);
    const code = (ax as { code?: string }).code;
    if (code && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET_BEFORE_SEND'].includes(code)) {
      return new TelegramSendError('TEMPORARY', description);
    }
    // Timeouts after the request was sent: Telegram may have delivered the message.
    return new TelegramSendError('AMBIGUOUS', description);
  }
}

export function assertTelegramConfigured(configured: boolean): void {
  if (!configured) {
    throw new AppError('INTEGRATION_NOT_CONFIGURED', 'The Telegram bot is not configured yet. Ask the administrator.');
  }
}

/** Escapes text for Telegram's HTML parse mode. */
export function tgEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
