/**
 * TEST DOUBLE — minimal Telegram Bot API server (getMe, sendMessage, setWebhook, deleteWebhook,
 * getWebhookInfo, getUpdates with long polling) with fault injection. Used only by the automated tests.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SentMessage {
  token: string;
  chatId: string;
  text: string;
  parseMode?: string;
  at: number;
}

type Fault = { method: string; times: number } & ({ kind: 'status'; status: number; description: string; retryAfter?: number } | { kind: 'drop' });

export class FakeTelegram {
  private server!: http.Server;
  port = 0;
  readonly validTokens = new Set<string>();
  readonly botUsername = 'adpilot_test_bot';
  readonly sent: SentMessage[] = [];
  readonly calls: { method: string; token: string; body: Record<string, unknown> }[] = [];
  private updates: Record<string, unknown>[] = [];
  private nextUpdateId = 1;
  private webhook: { url: string; secret?: string } | null = null;
  private faults: Fault[] = [];
  private pollers: (() => void)[] = [];

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const wake of this.pollers.splice(0)) wake();
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  reset(): void {
    this.sent.length = 0;
    this.calls.length = 0;
    this.updates = [];
    this.faults = [];
    this.webhook = null;
  }

  inject(fault: Fault): void {
    this.faults.push(fault);
  }

  sentTo(chatId: string | number): SentMessage[] {
    return this.sent.filter((m) => m.chatId === String(chatId));
  }

  /** Simulates a user writing to the bot in a private chat (delivered through getUpdates). */
  userSends(chatId: number, text: string, from: { username?: string; first_name?: string } = {}): Record<string, unknown> {
    const update = {
      update_id: this.nextUpdateId++,
      message: {
        message_id: Math.floor(Math.random() * 1e6),
        text,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private', username: from.username, first_name: from.first_name },
        from: { id: chatId, is_bot: false, username: from.username, first_name: from.first_name },
      },
    };
    this.updates.push(update);
    for (const wake of this.pollers.splice(0)) wake();
    return update;
  }

  async waitForMessage(chatId: string | number, predicate: (m: SentMessage) => boolean = () => true, timeoutMs = 15_000): Promise<SentMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = this.sentTo(chatId).find(predicate);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for a Telegram message to ${chatId}`);
  }

  private takeFault(method: string): Fault | undefined {
    const f = this.faults.find((x) => x.method === method && x.times > 0);
    if (f) f.times--;
    return f;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
    const send = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    };
    if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' });
    const [, token = '', method = ''] = m;
    this.calls.push({ method, token, body });
    if (!this.validTokens.has(token)) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });

    const fault = this.takeFault(method);
    if (fault?.kind === 'status') {
      return send(fault.status, {
        ok: false,
        error_code: fault.status,
        description: fault.description,
        ...(fault.retryAfter ? { parameters: { retry_after: fault.retryAfter } } : {}),
      });
    }

    switch (method) {
      case 'getMe':
        return send(200, { ok: true, result: { id: 777000111, is_bot: true, first_name: 'AdPilot Test', username: this.botUsername } });
      case 'sendMessage': {
        const text = String(body.text ?? '');
        if (!text) return send(400, { ok: false, error_code: 400, description: 'Bad Request: message text is empty' });
        if (text.length > 4096) return send(400, { ok: false, error_code: 400, description: 'Bad Request: message is too long' });
        if (body.parse_mode === 'HTML' && !balancedHtml(text)) {
          return send(400, { ok: false, error_code: 400, description: "Bad Request: can't parse entities" });
        }
        const msg: SentMessage = { token, chatId: String(body.chat_id), text, parseMode: body.parse_mode as string | undefined, at: Date.now() };
        this.sent.push(msg);
        if (fault?.kind === 'drop') {
          // Delivered, but the HTTP answer is lost (ambiguous outcome for the sender).
          req.socket.destroy();
          return;
        }
        return send(200, { ok: true, result: { message_id: this.sent.length, chat: { id: Number(body.chat_id) }, text } });
      }
      case 'setWebhook':
        this.webhook = { url: String(body.url), secret: body.secret_token as string | undefined };
        return send(200, { ok: true, result: true, description: 'Webhook was set' });
      case 'deleteWebhook':
        this.webhook = null;
        return send(200, { ok: true, result: true, description: 'Webhook was deleted' });
      case 'getWebhookInfo':
        return send(200, { ok: true, result: { url: this.webhook?.url ?? '', pending_update_count: this.updates.length } });
      case 'getUpdates': {
        if (this.webhook) return send(409, { ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active" });
        const offset = Number(body.offset ?? 0);
        const pending = () => this.updates.filter((u) => Number(u.update_id) >= offset);
        if (!pending().length) {
          const timeoutMs = Math.min(Number(body.timeout ?? 0), 2) * 1000;
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, timeoutMs);
            this.pollers.push(() => (clearTimeout(t), resolve()));
          });
        }
        return send(200, { ok: true, result: pending() });
      }
      default:
        return send(404, { ok: false, error_code: 404, description: 'Not Found: method not found' });
    }
  }
}

/** Very small validator for Telegram's HTML subset: every opened tag must be closed in order. */
function balancedHtml(text: string): boolean {
  const stack: string[] = [];
  const re = /<\/?([a-z-]+)(?:\s[^>]*)?>|<|&(?!(?:amp|lt|gt|quot|#\d+);)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[0];
    if (token === '<' || token.startsWith('&')) return false;
    const name = m[1]!.toLowerCase();
    if (token.startsWith('</')) {
      if (stack.pop() !== name) return false;
    } else if (!token.endsWith('/>')) stack.push(name);
  }
  return stack.length === 0;
}
