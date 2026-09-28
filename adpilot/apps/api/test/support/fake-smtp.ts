/**
 * TEST DOUBLE — minimal SMTP server (RFC 5321 subset: EHLO/HELO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, RSET,
 * NOOP, QUIT) that captures messages in memory. Used only by the automated tests; never shipped.
 */
import net, { type AddressInfo } from 'node:net';

export interface CapturedMail {
  from: string;
  to: string[];
  raw: string;
  subject: string;
  /** Decoded text content (quoted-printable soft breaks removed) for assertions. */
  text: string;
  auth?: { user: string; pass: string };
}

export class FakeSmtp {
  private server!: net.Server;
  port = 0;
  readonly messages: CapturedMail[] = [];
  /** Next N messages are rejected with this reply (e.g. "451 4.3.0 Try again later"). */
  private rejectNext: { times: number; reply: string } | null = null;
  private readonly waiters: {
    predicate: (m: CapturedMail) => boolean;
    resolve: (m: CapturedMail) => void;
  }[] = [];

  /** Called for every captured message (used by the standalone development mode). */
  onMessage: ((m: CapturedMail) => void) | null = null;

  async start(): Promise<void> {
    await this.startOn(0);
  }

  async startOn(port: number): Promise<void> {
    this.server = net.createServer((socket) => this.session(socket));
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  reset(): void {
    this.messages.length = 0;
    this.rejectNext = null;
  }

  failNext(times: number, reply = '451 4.3.0 Temporary failure, try again later'): void {
    this.rejectNext = { times, reply };
  }

  to(address: string): CapturedMail[] {
    return this.messages.filter((m) => m.to.includes(address.toLowerCase()));
  }

  /** Resolves with the first (already received or future) message matching the predicate. */
  waitFor(predicate: (m: CapturedMail) => boolean, timeoutMs = 15_000): Promise<CapturedMail> {
    const found = this.messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for e-mail')), timeoutMs);
      this.waiters.push({ predicate, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }

  private session(socket: net.Socket): void {
    let buffer = '';
    let inData = false;
    let data: string[] = [];
    let from = '';
    let to: string[] = [];
    let auth: { user: string; pass: string } | undefined;
    let authStep: null | 'login-user' | 'login-pass' = null;
    let loginUser = '';
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake-smtp ESMTP ready');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            if (this.rejectNext && this.rejectNext.times > 0) {
              this.rejectNext.times--;
              reply(this.rejectNext.reply);
            } else {
              this.capture(from, to, data.join('\r\n'), auth);
              reply('250 2.0.0 OK queued');
            }
            data = [];
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        if (authStep === 'login-user') {
          loginUser = Buffer.from(line, 'base64').toString();
          authStep = 'login-pass';
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (authStep === 'login-pass') {
          auth = { user: loginUser, pass: Buffer.from(line, 'base64').toString() };
          authStep = null;
          reply('235 2.7.0 Authentication successful');
          continue;
        }
        const [cmd = '', ...rest] = line.split(' ');
        const arg = rest.join(' ');
        switch (cmd.toUpperCase()) {
          case 'EHLO':
            socket.write('250-fake-smtp\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
            break;
          case 'HELO':
            reply('250 fake-smtp');
            break;
          case 'AUTH': {
            const [mech, initial] = arg.split(' ');
            if (mech?.toUpperCase() === 'PLAIN' && initial) {
              const [, user = '', pass = ''] = Buffer.from(initial, 'base64').toString().split('\0');
              auth = { user, pass };
              reply('235 2.7.0 Authentication successful');
            } else if (mech?.toUpperCase() === 'LOGIN') {
              authStep = 'login-user';
              reply('334 VXNlcm5hbWU6');
            } else reply('504 5.5.4 Unrecognized authentication type');
            break;
          }
          case 'MAIL':
            from = /<([^>]*)>/.exec(arg)?.[1] ?? '';
            to = [];
            reply('250 2.1.0 OK');
            break;
          case 'RCPT':
            to.push((/<([^>]*)>/.exec(arg)?.[1] ?? '').toLowerCase());
            reply('250 2.1.5 OK');
            break;
          case 'DATA':
            inData = true;
            reply('354 End data with <CR><LF>.<CR><LF>');
            break;
          case 'RSET':
            from = '';
            to = [];
            reply('250 2.0.0 OK');
            break;
          case 'NOOP':
            reply('250 2.0.0 OK');
            break;
          case 'QUIT':
            reply('221 2.0.0 Bye');
            socket.end();
            break;
          default:
            reply('502 5.5.2 Command not implemented');
        }
      }
    });
    socket.on('error', () => undefined);
  }

  private capture(from: string, to: string[], raw: string, auth?: { user: string; pass: string }): void {
    const headerEnd = raw.indexOf('\r\n\r\n');
    const headers = raw.slice(0, headerEnd);
    const subjectLine = /^Subject: (.*(?:\r\n[ \t].*)*)/im.exec(headers)?.[1] ?? '';
    const subject = decodeMimeWords(subjectLine.replace(/\r\n[ \t]/g, ' '));
    const text = raw
      .slice(headerEnd + 4)
      .replace(/=\r\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    const mail: CapturedMail = { from, to, raw, subject, text, auth };
    this.messages.push(mail);
    this.onMessage?.(mail);
    for (const w of [...this.waiters]) {
      if (w.predicate(mail)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(mail);
      }
    }
  }
}

function decodeMimeWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi,
    (_, _charset: string, enc: string, data: string) =>
      enc.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64').toString('utf8')
        : Buffer.from(
            data
              .replace(/_/g, ' ')
              .replace(/=([0-9A-F]{2})/gi, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16))),
            'latin1',
          ).toString('utf8'),
  );
}

/** The one-time token of an e-mail link (carried in the URL fragment: `#token=…`). */
export function tokenFrom(url: string): string {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  if (!token) throw new Error(`No token in the fragment of ${url}`);
  return token;
}

/** Extracts the first URL containing `fragment` from a captured e-mail. */
export function linkFrom(mail: CapturedMail, fragment: string): string {
  const urls = mail.text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const url = urls.find((u) => u.includes(fragment));
  if (!url) throw new Error(`No link containing "${fragment}" in e-mail "${mail.subject}"`);
  return url.replace(/&amp;/g, '&');
}

// DEVELOPMENT ONLY: `node --experimental-strip-types test/support/fake-smtp.ts [port]` runs a local mail catcher.
// Configure Super Admin → SMTP with host 127.0.0.1, this port and encryption "None"; every message is printed
// with its links (invitations, password resets).
if (process.argv[1]?.endsWith('fake-smtp.ts')) {
  const smtp = new FakeSmtp();
  const port = Number(process.argv[2] ?? 2525);
  void smtp.startOn(port).then(() => console.log(`Mail catcher listening on 127.0.0.1:${port}`));
  smtp.onMessage = (m) => {
    const links = m.text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    console.log(
      JSON.stringify(
        { to: m.to, subject: m.subject, links: [...new Set(links.map((l) => l.replace(/&amp;/g, '&')))] },
        null,
        2,
      ),
    );
  };
}
