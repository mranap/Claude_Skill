import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { SystemLogService } from '../system-log/system-log.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { AppError } from '../../common/errors/app-error';
import type { Prisma } from '../../generated/prisma/client';

/** A running backup renews its heartbeat this often. */
const HEARTBEAT_MS = 30_000;
/** A RUNNING backup without a heartbeat for this long lost its worker (crash, SIGKILL after the grace period). */
const RUNNING_ABANDONED_MS = 3 * 60_000;
/** A backup that has not started within this time is given up (its job was lost or no worker consumes it). */
const QUEUED_ABANDONED_MS = 60 * 60_000;

/** Marks backups whose worker died, or whose job never ran, as FAILED so they stop blocking new backups. */
export async function failAbandonedBackups(db: Prisma.TransactionClient): Promise<number> {
  const now = Date.now();
  const silentSince = new Date(now - RUNNING_ABANDONED_MS);
  const running = await db.backup.updateMany({
    where: {
      status: 'RUNNING',
      OR: [{ heartbeatAt: { lt: silentSince } }, { heartbeatAt: null, startedAt: { lt: silentSince } }],
    },
    data: { status: 'FAILED', error: 'The worker stopped during the backup', finishedAt: new Date() },
  });
  const queued = await db.backup.updateMany({
    where: { status: 'QUEUED', startedAt: { lt: new Date(now - QUEUED_ABANDONED_MS) } },
    data: {
      status: 'FAILED',
      error: `The backup did not start within ${QUEUED_ABANDONED_MS / 60_000} minutes`,
      finishedAt: new Date(),
    },
  });
  return running.count + queued.count;
}

/**
 * Creates and queues a database backup unless one is already QUEUED or RUNNING (then `null`). With
 * `scheduledSince`, also `null` when a scheduled backup was created since then. The check and the insert run
 * under a transaction-scoped advisory lock, so concurrent requests (two administrators, the scheduled backup
 * next to a manual one, two scheduler replicas) can never start two dumps.
 */
export async function queueBackup(
  prisma: PrismaService,
  queue: QueueService,
  opts: { triggeredById: string | null; scheduledSince?: Date },
): Promise<{ id: string } | null> {
  const backup = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('adpilot:backups'))`;
    await failAbandonedBackups(tx);
    if (await tx.backup.findFirst({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } }))
      return null;
    if (
      opts.scheduledSince &&
      (await tx.backup.findFirst({
        where: { triggeredById: null, startedAt: { gte: opts.scheduledSince } },
        select: { id: true },
      }))
    ) {
      return null;
    }
    return tx.backup.create({
      data: { kind: 'DATABASE', status: 'QUEUED', triggeredById: opts.triggeredById },
      select: { id: true },
    });
  });
  if (!backup) return null;
  try {
    await queue.add(
      QUEUES.MAINTENANCE,
      JOBS.DATABASE_BACKUP,
      { kind: 'backup', backupId: backup.id },
      { jobId: jobId('backup', backup.id), attempts: 1 },
    );
  } catch (err) {
    // Without a job the row would stay QUEUED: fail it right away.
    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        status: 'FAILED',
        error: `Could not queue the backup: ${(err as Error).message}`.slice(0, 1000),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
  return backup;
}

/**
 * PostgreSQL backups (pg_dump custom format) uploaded to the backup bucket. The encryption master key is
 * NOT part of the dump — it only exists in the environment — so a leaked backup does not expose Meta tokens,
 * proxy passwords or SMTP/Telegram secrets. Object storage and configuration backups are documented in
 * docs/DEPLOYMENT.md (bucket replication / `mc mirror`, and keeping `.env` in a secrets manager).
 */
@Injectable()
export class BackupService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly systemLog: SystemLogService,
    private readonly queue: QueueService,
  ) {}

  private get bucket(): string {
    return this.config.env.S3_BACKUP_BUCKET || this.config.env.S3_BUCKET;
  }

  async request(triggeredById: string | null): Promise<{ id: string }> {
    const backup = await queueBackup(this.prisma, this.queue, { triggeredById });
    if (!backup) throw AppError.conflict('A backup is already running');
    return backup;
  }

  async list() {
    return this.prisma.backup.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
  }

  async run(backupId: string): Promise<void> {
    const now = new Date();
    const claimed = await this.prisma.backup.updateMany({
      where: { id: backupId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: now, heartbeatAt: now },
    });
    if (claimed.count !== 1) return;
    const heartbeat = setInterval(() => {
      void this.prisma.backup
        .updateMany({ where: { id: backupId, status: 'RUNNING' }, data: { heartbeatAt: new Date() } })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    const dir = join(this.config.env.TMP_DIR, 'backups');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `adpilot-db-${stamp}.dump`);
    const key = `backups/database/adpilot-db-${stamp}.dump`;
    try {
      await mkdir(dir, { recursive: true });
      await this.pgDump(file);
      const size = (await stat(file)).size;
      await this.storage.ensureBucket(this.bucket);
      await this.storage.uploadFile(key, file, 'application/octet-stream', this.bucket);
      await this.prisma.backup.update({
        where: { id: backupId },
        data: { status: 'SUCCESS', storageKey: key, sizeBytes: BigInt(size), finishedAt: new Date() },
      });
      await this.prune();
    } catch (err) {
      await this.prisma.backup.update({
        where: { id: backupId },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000), finishedAt: new Date() },
      });
      await this.systemLog.error('backup', `Database backup failed: ${(err as Error).message}`);
      throw err;
    } finally {
      clearInterval(heartbeat);
      await rm(file, { force: true });
    }
  }

  private pgDump(outFile: string): Promise<void> {
    const url = new URL(this.config.env.DATABASE_URL);
    const args = [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--file=${outFile}`,
      `--host=${url.hostname}`,
      `--port=${url.port || '5432'}`,
      `--username=${decodeURIComponent(url.username)}`,
      decodeURIComponent(url.pathname.replace(/^\//, '')),
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.env.PG_DUMP_PATH, args, {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}: ${stderr.slice(0, 500)}`)),
      );
    });
  }

  private async prune(): Promise<void> {
    const { keepLast } = await this.settings.get('backups');
    const old = await this.prisma.backup.findMany({
      where: { status: 'SUCCESS' },
      orderBy: { startedAt: 'desc' },
      skip: keepLast,
    });
    for (const b of old) {
      if (b.storageKey) await this.storage.delete(b.storageKey, this.bucket).catch(() => undefined);
      await this.prisma.backup.delete({ where: { id: b.id } });
    }
  }
}
