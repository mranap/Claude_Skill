/**
 * Integration/e2e harness: runs the real API (HTTP), worker and scheduler Nest applications in-process
 * against a dedicated PostgreSQL test database and Redis database, with test doubles for the external
 * systems (Meta Graph API emulator, S3, SMTP, Telegram Bot API). Nothing in the application is mocked.
 */
import { INestApplicationContext, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { SYSTEM_ROLES } from '@adpilot/shared';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { AppModule } from '../../src/app.module';
import { WorkerModule } from '../../src/worker.module';
import { SchedulerModule } from '../../src/scheduler.module';
import { SchedulerService } from '../../src/scheduler/scheduler.service';
import { TelegramPollerService } from '../../src/scheduler/telegram-poller.service';
import { configureHttpApp } from '../../src/bootstrap/http-app';
import { resetEnvCache } from '../../src/config/env';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createCliPrisma } from '../../src/cli/cli-prisma';
import { seedRbac } from '../../src/cli/seed-core';
import { ensureSuperAdmin } from '../../src/cli/super-admin';
import { MetaEmulator } from './meta-emulator';
import { FakeS3 } from './fake-s3';
import { FakeSmtp } from './fake-smtp';
import { FakeTelegram } from './fake-telegram';
import { ApiClient, expectStatus } from './http-client';

export interface StackOptions {
  /** Start the BullMQ worker process (default true). */
  worker?: boolean;
  /** Build the scheduler context; its timer is disabled and tasks are run explicitly with runTask(). */
  scheduler?: boolean;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: ApiClient;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TestStack {
  readonly meta = new MetaEmulator();
  readonly s3 = new FakeS3();
  readonly smtp = new FakeSmtp();
  readonly telegram = new FakeTelegram();
  api!: NestExpressApplication;
  worker: INestApplicationContext | null = null;
  scheduler: TestingModule | null = null;
  baseUrl = '';
  private userSeq = 0;

  get prisma(): PrismaService {
    return this.api.get(PrismaService);
  }

  get superAdmin(): { email: string; password: string } {
    return { email: process.env.SUPER_ADMIN_EMAIL!, password: process.env.SUPER_ADMIN_PASSWORD! };
  }

  async start(opts: StackOptions = {}): Promise<this> {
    await Promise.all([this.meta.start(), this.s3.start(), this.smtp.start(), this.telegram.start()]);
    for (const bucket of [process.env.S3_BUCKET!, process.env.S3_BACKUP_BUCKET!]) this.s3.buckets.set(bucket, new Map());
    Object.assign(process.env, {
      META_GRAPH_BASE_URL: this.meta.baseUrl,
      META_GRAPH_VIDEO_BASE_URL: this.meta.baseUrl,
      S3_ENDPOINT: this.s3.endpoint,
      TELEGRAM_API_BASE_URL: this.telegram.baseUrl,
    });
    resetEnvCache();
    await this.resetStores();

    this.api = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'fatal'], bodyParser: false });
    configureHttpApp(this.api);
    await this.api.listen(0, '127.0.0.1');
    this.baseUrl = (await this.api.getUrl()).replace('[::1]', '127.0.0.1');

    if (opts.worker !== false) await this.startWorker();
    if (opts.scheduler) await this.startScheduler();
    return this;
  }

  async stop(): Promise<void> {
    const dbg = (m: string) => process.env.DEBUG_HARNESS && console.error(`DBG stop: ${m}`, new Date().toISOString());
    dbg('worker');
    await this.stopWorker();
    dbg('scheduler');
    await this.scheduler?.close();
    dbg('api');
    await this.api?.close();
    dbg('fakes');
    await Promise.allSettled([this.meta.stop(), this.s3.stop(), this.smtp.stop(), this.telegram.stop()]);
    dbg('done');
  }

  async startWorker(): Promise<void> {
    this.worker = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'fatal'] });
    await this.worker.init();
  }

  async stopWorker(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  /** Simulates a worker crash/redeploy: the process goes away and a fresh one starts. */
  async restartWorker(): Promise<void> {
    await this.stopWorker();
    await this.startWorker();
  }

  private async startScheduler(): Promise<void> {
    this.scheduler = await Test.createTestingModule({ imports: [SchedulerModule] })
      .overrideProvider(SchedulerService)
      .useValue({ isLeader: true, onApplicationBootstrap: () => undefined, onApplicationShutdown: () => undefined })
      .overrideProvider(TelegramPollerService)
      .useValue({ onApplicationBootstrap: () => undefined, onApplicationShutdown: () => undefined })
      .setLogger({ log() {}, warn() {}, error() {}, debug() {}, verbose() {}, fatal() {} } as never)
      .compile();
    await this.scheduler.init();
  }

  /** Runs one scheduler task immediately (the production scheduler runs the same method on its timer). */
  async runTask(task: Type<{ run(): Promise<void> }>): Promise<void> {
    if (!this.scheduler) throw new Error('Start the stack with { scheduler: true }');
    await this.scheduler.get(task).run();
  }

  /** Empties the test database and Redis namespace, then seeds RBAC and the Super Admin from ENV. */
  private async resetStores(): Promise<void> {
    const redis = new IORedis(process.env.REDIS_URL!, { lazyConnect: true });
    await redis.connect();
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${process.env.QUEUE_PREFIX}:*`, 'COUNT', 1000);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    } finally {
      redis.disconnect();
    }

    const prisma = createCliPrisma();
    try {
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      if (tables.length) {
        const list = tables.map((t: { tablename: string }) => `"public"."${t.tablename}"`).join(', ');
        await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
      }
      await seedRbac(prisma);
      await ensureSuperAdmin(prisma, { email: this.superAdmin.email, password: this.superAdmin.password, name: process.env.SUPER_ADMIN_NAME });
    } finally {
      await prisma.$disconnect();
    }
  }

  client(): ApiClient {
    return new ApiClient(this.baseUrl);
  }

  async loginSuperAdmin(): Promise<ApiClient> {
    const c = this.client();
    expectStatus(await c.login(this.superAdmin.email, this.superAdmin.password), 200);
    return c;
  }

  async roleId(key: string): Promise<string> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { key } });
    return role.id;
  }

  /**
   * Creates a user through the admin API (temporary password), logs in and sets the definitive password —
   * the same path a real user takes on first login.
   */
  async createUser(admin: ApiClient, opts: { role?: string; email?: string; name?: string; timezone?: string } = {}): Promise<TestUser> {
    const n = ++this.userSeq;
    const email = opts.email ?? `user${n}.${Date.now()}@adpilot.test`;
    const temporary = `Temp${n}pass${Math.random().toString(36).slice(2, 10)}`;
    const created = expectStatus(
      await admin.post('/api/admin/users', {
        email,
        name: opts.name ?? `User ${n}`,
        roleId: await this.roleId(opts.role ?? SYSTEM_ROLES.USER),
        mode: 'password',
        password: temporary,
        timezone: opts.timezone,
      }),
      201,
    ).body as { id: string };
    const client = this.client();
    expectStatus(await client.login(email, temporary), 200);
    const password = `Final${n}pass${Math.random().toString(36).slice(2, 10)}`;
    expectStatus(await client.post('/api/account/password', { currentPassword: temporary, newPassword: password }), 200);
    if (!(await client.get('/api/auth/me')).status.toString().startsWith('2')) {
      expectStatus(await client.login(email, password), 200);
    }
    return { id: created.id, email, password, client };
  }

  /** Updates a settings group and makes every running context see it immediately. */
  async setSettings(key: Parameters<SettingsService['update']>[0], patch: Record<string, unknown>, secrets: Record<string, string | null> = {}): Promise<void> {
    await this.api.get(SettingsService).update(key, patch as never, secrets);
    for (const ctx of [this.api, this.worker, this.scheduler]) await ctx?.get(SettingsService).invalidate(key);
  }

  async configureSmtp(): Promise<void> {
    await this.setSettings('smtp', {
      enabled: true,
      host: '127.0.0.1',
      port: this.smtp.port,
      encryption: 'NONE',
      username: 'mailer',
      fromEmail: 'noreply@adpilot.test',
      fromName: 'AdPilot',
    }, { password: 'smtp-test-password' });
  }

  async configureTelegram(botToken = `${Math.floor(Math.random() * 1e9)}:TEST${Math.random().toString(36).slice(2)}`): Promise<string> {
    this.telegram.validTokens.add(botToken);
    await this.setSettings('telegram', { enabled: true, mode: 'WEBHOOK', botUsername: this.telegram.botUsername }, { botToken, webhookSecret: 'tg-webhook-secret-for-tests' });
    return botToken;
  }

  /**
   * Moves delayed jobs of a queue to "waiting" — simulates the passing of time for deferred jobs (video
   * processing, rate-limit cool-downs, retry back-off) without changing any production timing.
   */
  async promoteDelayed(queueName: string): Promise<number> {
    const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const queue = new Queue(queueName, { connection, prefix: `${process.env.QUEUE_PREFIX}:bull` });
    try {
      const delayed = await queue.getDelayed();
      for (const job of delayed) await job.promote().catch(() => undefined);
      return delayed.length;
    } finally {
      await queue.close();
      connection.disconnect();
    }
  }

  /** Forgets all Meta rate-limit blocks (simulates the cool-down having passed). */
  async clearMetaRateLimits(): Promise<void> {
    const redis = new IORedis(process.env.REDIS_URL!);
    try {
      const keys = await redis.keys(`${process.env.QUEUE_PREFIX}:meta:rl:*`);
      if (keys.length) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
  }

  /** Polls until the predicate returns a truthy value. */
  async waitFor<T>(fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {}): Promise<T> {
    const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        const v = await fn();
        if (v) return v as T;
      } catch (err) {
        last = err;
      }
      await sleep(opts.intervalMs ?? 100);
    }
    throw new Error(`${opts.message ?? 'Condition not met in time'}${last ? `: ${(last as Error).message}` : ''}`);
  }
}
