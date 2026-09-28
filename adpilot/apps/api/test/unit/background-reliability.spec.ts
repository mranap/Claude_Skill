import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { defaultSettings } from '@adpilot/shared';
import { SchedulerService } from '../../src/scheduler/scheduler.service';
import type { SchedulerTask } from '../../src/scheduler/scheduler-task';
import { TelegramPollerService } from '../../src/scheduler/telegram-poller.service';
import { OutboxSweepTask } from '../../src/scheduler/tasks/platform.tasks';
import { EmailProcessor } from '../../src/worker/processors/email.processor';
import { TelegramProcessor } from '../../src/worker/processors/telegram.processor';
import { UnrecoverableError } from '../../src/worker/job-errors';
import { SmtpSendError, SmtpService } from '../../src/modules/mail/smtp.service';
import { TelegramBotService, TelegramSendError, type TelegramUpdate } from '../../src/modules/telegram/telegram-bot.service';
import { RetentionService } from '../../src/modules/maintenance/retention.service';

/** Test doubles implement only what the code under test calls. */
const fake = <T>(value: object): T => value as unknown as T;

describe('scheduler leadership', () => {
  afterEach(() => vi.useRealTimers());

  function locks(valid: () => boolean = () => true) {
    const calls: string[] = [];
    return {
      calls,
      acquire: vi.fn(async () => (calls.push('acquire'), { key: 'lock:scheduler:leader', token: 't1' })),
      extend: vi.fn(async () => (calls.push('extend'), valid())),
      release: vi.fn(async () => void calls.push('release')),
    };
  }
  const redis = { key: (...parts: string[]) => parts.join(':'), client: { set: async () => 'OK' } };
  const systemLog = { error: async () => undefined };

  /** A task that keeps running until the test lets it finish. */
  function blockingTask(name: string) {
    let release = () => {};
    return {
      name,
      everyMs: 1000,
      run: vi.fn(() => new Promise<void>((r) => (release = r))),
      finish: () => release(),
    } satisfies SchedulerTask & { finish: () => void };
  }

  it('keeps the leader lock alive during a long tick and hands it over only after the running task finished', async () => {
    vi.useFakeTimers();
    const l = locks();
    const slow = blockingTask('slow');
    const scheduler = new SchedulerService([slow], fake(l), fake(redis), fake(systemLog));
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1);
    expect(slow.run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_000); // longer than the 30 s lock TTL
    expect(l.extend.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(scheduler.isLeader).toBe(true);

    const stopped = scheduler.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(20_000);
    // The task's jobs must reach Redis before the queues close: leadership is kept until it finished.
    expect(l.release).not.toHaveBeenCalled();
    slow.finish();
    await stopped;
    expect(l.calls.at(-1)).toBe('release');
  });

  it('a replica that loses the lock during a tick runs no further task', async () => {
    vi.useFakeTimers();
    let lockIsOurs = true;
    const l = locks(() => lockIsOurs);
    const first = blockingTask('first');
    const second = { name: 'second', everyMs: 1000, run: vi.fn(async () => undefined) };
    const scheduler = new SchedulerService([first, second], fake(l), fake(redis), fake(systemLog));
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1);
    expect(first.run).toHaveBeenCalledTimes(1);

    lockIsOurs = false; // the lock expired and another replica acquired it
    await vi.advanceTimersByTimeAsync(10_000);
    expect(scheduler.isLeader).toBe(false);
    first.finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.run).not.toHaveBeenCalled();
    await scheduler.onModuleDestroy();
  });
});

describe('Telegram polling during a leader hand-over', () => {
  it('handles each update once when two pollers received the same batch', async () => {
    const store = new Map<string, string>();
    const redis = {
      key: (...parts: (string | number)[]) => ['t', ...parts].join(':'),
      client: {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string, ...args: unknown[]) => {
          if (args.includes('NX') && store.has(k)) return null;
          store.set(k, v);
          return 'OK';
        },
      },
    };
    const handled: number[] = [];
    const links = { handleUpdate: vi.fn(async (u: TelegramUpdate) => void handled.push(u.update_id)) };
    const poller = () => new TelegramPollerService(fake({}), fake({}), fake(links), fake(redis), fake({}));
    const update = (id: number): TelegramUpdate => ({ update_id: id, message: { message_id: id, text: '/start c0de', chat: { id: 7, type: 'private' } } });
    const batch = [update(41), update(42)];

    await Promise.all([poller().handleUpdates(batch), poller().handleUpdates(batch)]);
    expect(handled.sort((a, b) => a - b)).toEqual([41, 42]);
    expect(store.get('t:telegram:offset')).toBe('43');
  });
});

describe('notification deliveries: nothing sent means temporary', () => {
  const user = { id: 'u1', email: 'user@adpilot.test', status: 'ACTIVE', telegramConnection: { isActive: true, chatId: '7' } };
  const claimed = { notification: { title: 'Budget changed', body: 'Ad set "A": 10 → 12', link: null, severity: 'INFO', user } };
  const systemLog = { warn: vi.fn(async () => undefined), error: vi.fn(async () => undefined) };
  const settings = { get: vi.fn(async () => ({ platformName: 'AdPilot' })) };
  const deliveryJob = (attemptsMade = 0) => fake<Job>({ data: { kind: 'delivery', deliveryId: 'd1' }, attemptsMade, opts: { attempts: 6 } });

  function deliveries() {
    const calls: string[] = [];
    return {
      calls,
      claim: vi.fn(async () => (calls.push('claim'), claimed)),
      release: vi.fn(async () => void calls.push('release')),
      markFinal: vi.fn(async (_id: string, status: string) => void calls.push(`final:${status}`)),
      markSent: vi.fn(async () => void calls.push('sent')),
      absoluteLink: () => undefined,
    };
  }
  const emailProcessor = (smtp: object, d: object, s: object = settings, encryption: object = {}) =>
    new EmailProcessor(fake(smtp), fake(d), fake(s), fake(systemLog), fake(encryption));

  it('e-mail: settings are loaded before the claim, so a failure leaves the delivery PENDING for the retry', async () => {
    const d = deliveries();
    const broken = { get: vi.fn(async () => Promise.reject(new Error('database unavailable'))) };
    await expect(emailProcessor({ send: vi.fn() }, d, broken).process(deliveryJob())).rejects.toThrow('database unavailable');
    expect(d.calls).toEqual([]);
  });

  it('e-mail: an error that is not an SMTP answer is released and retried, and FAILED only after the last attempt', async () => {
    const smtp = { send: vi.fn(async () => Promise.reject(new TypeError('template error'))) };
    const d = deliveries();
    await expect(emailProcessor(smtp, d).process(deliveryJob(0))).rejects.toThrow('template error');
    expect(d.calls).toEqual(['claim', 'release']);
    const last = deliveries();
    await expect(emailProcessor(smtp, last).process(deliveryJob(5))).resolves.toEqual({ status: 'FAILED' });
    expect(last.calls).toEqual(['claim', 'final:FAILED']);
  });

  it('e-mail: failing to record a sent message is never treated as a send failure', async () => {
    const d = deliveries();
    d.markSent.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(emailProcessor({ send: vi.fn(async () => ({ messageId: 'm1' })) }, d).process(deliveryJob())).rejects.toThrow('database unavailable');
    expect(d.release).not.toHaveBeenCalled();
    expect(d.markFinal).not.toHaveBeenCalled();
  });

  it('e-mail: a sealed message that cannot be decrypted fails at once instead of being retried', async () => {
    const smtp = { send: vi.fn() };
    const encryption = { decrypt: () => { throw new Error('Malformed encrypted value'); } };
    const sealed = fake<Job>({ data: { kind: 'sealed', sealed: 'enc1:damaged', tag: 'password_reset' }, attemptsMade: 0, opts: { attempts: 5 } });
    await expect(emailProcessor(smtp, deliveries(), settings, encryption).process(sealed)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(smtp.send).not.toHaveBeenCalled();
    expect(systemLog.error).toHaveBeenCalledWith('email', expect.stringMatching(/cannot be opened/), { tag: 'password_reset' }, undefined);
  });

  it('Telegram: an error that is not a Bot API answer is released and retried', async () => {
    const bot = { sendMessage: vi.fn(async () => Promise.reject(new TypeError('formatting error'))) };
    const d = deliveries();
    await expect(new TelegramProcessor(fake(bot), fake(d), fake({}), fake(systemLog)).process(deliveryJob(0))).rejects.toThrow('formatting error');
    expect(d.calls).toEqual(['claim', 'release']);
  });

  it('Telegram: failing to record a sent message is never treated as a send failure', async () => {
    const d = deliveries();
    d.markSent.mockRejectedValueOnce(new Error('database unavailable'));
    const bot = { sendMessage: vi.fn(async () => ({ message_id: 1 })) };
    await expect(new TelegramProcessor(fake(bot), fake(d), fake({}), fake(systemLog)).process(deliveryJob())).rejects.toThrow('database unavailable');
    expect(d.release).not.toHaveBeenCalled();
    expect(d.markFinal).not.toHaveBeenCalled();
  });

  it('SMTP and Telegram clients report settings that cannot be loaded as temporary failures', async () => {
    const broken = { get: async () => Promise.reject(new Error('database unavailable')), getSecret: async () => null };
    const smtpErr = await new SmtpService(fake(broken)).send({ to: 'a@adpilot.test', subject: 's', html: '<p>h</p>', text: 't' }).catch((e: unknown) => e);
    expect(smtpErr).toBeInstanceOf(SmtpSendError);
    expect(smtpErr).toMatchObject({ kind: 'TEMPORARY' });
    const disabled = { get: async () => ({ enabled: false }), getSecret: async () => null };
    expect(await new SmtpService(fake(disabled)).send({ to: 'a@adpilot.test', subject: 's', html: 'h', text: 't' }).catch((e: unknown) => e)).toMatchObject({ kind: 'NOT_CONFIGURED' });

    const bot = new TelegramBotService(fake(broken), fake({ env: { TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9' } }));
    const tgErr = await bot.sendMessage('7', 'hello').catch((e: unknown) => e);
    expect(tgErr).toBeInstanceOf(TelegramSendError);
    expect(tgErr).toMatchObject({ kind: 'TEMPORARY' });
  });
});

describe('retention cleanup', () => {
  it('a failing table does not skip the others; the audit batch gets explicit transaction limits', async () => {
    const tables: string[] = [];
    let auditTxOptions: unknown;
    const prisma = {
      $executeRawUnsafe: vi.fn(async (sql: string) => (tables.push(/DELETE FROM "(\w+)"/.exec(sql)![1]), 0)),
      $transaction: vi.fn(async (_fn: unknown, options: unknown) => {
        auditTxOptions = options;
        throw new Error('Transaction API error: Unable to start a transaction in the given time.');
      }),
      creativeFile: { findMany: async () => [] },
    };
    const systemLog = { error: vi.fn(async () => undefined), warn: vi.fn(async () => undefined), info: vi.fn(async () => undefined) };
    const retention = new RetentionService(fake(prisma), fake({ get: async () => defaultSettings('retention') }), fake(systemLog), fake({ all: () => [] }), fake({}));

    await expect(retention.run()).rejects.toThrow(/auditLogs/);
    expect(tables).toEqual(expect.arrayContaining(['meta_api_logs', 'system_logs', 'notifications', 'insights_daily', 'launch_jobs', 'sessions', 'telegram_link_codes']));
    expect(systemLog.error).toHaveBeenCalledWith('retention', expect.stringMatching(/auditLogs/), { step: 'auditLogs' });
    expect(auditTxOptions).toMatchObject({ maxWait: expect.any(Number), timeout: expect.any(Number) });
    expect((auditTxOptions as { timeout: number }).timeout).toBeGreaterThan(5000);
  });
});

describe('notification outbox sweep', () => {
  it('walks a large PENDING backlog oldest first, one batch per run, instead of re-reading the same rows', async () => {
    const base = Date.now() - 3600_000;
    // Groups of three rows share a timestamp: the id breaks the tie.
    const backlog = Array.from({ length: 1200 }, (_, i) => ({ id: `d${String(i).padStart(4, '0')}`, channel: 'EMAIL' as const, createdAt: new Date(base + Math.floor(i / 3) * 1000) }));
    type Row = (typeof backlog)[number];
    type Keyset = [{ createdAt: { gt: Date } }, { createdAt: Date; id: { gt: string } }];
    const findMany = vi.fn(async (args: { where: { OR?: Keyset }; take: number; orderBy: unknown }) => {
      const or = args.where.OR;
      const after = (r: Row) => !or || r.createdAt > or[0].createdAt.gt || (r.createdAt.getTime() === or[1].createdAt.getTime() && r.id > or[1].id.gt);
      return backlog.filter(after).slice(0, args.take);
    });
    const prisma = { notificationDelivery: { findMany, updateMany: async () => ({ count: 0 }) }, bulkOperation: { findMany: async () => [] } };
    const enqueued: string[] = [];
    const notifications = { enqueueDelivery: vi.fn(async (id: string) => void enqueued.push(id)) };
    const sweep = new OutboxSweepTask(fake(prisma), fake(notifications), fake({}));

    const run = async () => {
      enqueued.length = 0;
      await sweep.run();
      return [enqueued[0], enqueued.at(-1), enqueued.length];
    };
    expect(await run()).toEqual(['d0000', 'd0499', 500]);
    expect(await run()).toEqual(['d0500', 'd0999', 500]);
    expect(await run()).toEqual(['d1000', 'd1199', 200]);
    expect(await run()).toEqual(['d0000', 'd0499', 500]); // the backlog was fully walked: start over
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });
});
