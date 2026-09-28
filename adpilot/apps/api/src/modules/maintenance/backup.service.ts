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
    const running = await this.prisma.backup.findFirst({ where: { status: { in: ['QUEUED', 'RUNNING'] } } });
    if (running) throw AppError.conflict('A backup is already running');
    const backup = await this.prisma.backup.create({ data: { kind: 'DATABASE', status: 'QUEUED', triggeredById } });
    await this.queue.add(QUEUES.MAINTENANCE, JOBS.DATABASE_BACKUP, { kind: 'backup', backupId: backup.id }, { jobId: jobId('backup', backup.id), attempts: 1 });
    return { id: backup.id };
  }

  async list() {
    return this.prisma.backup.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
  }

  async run(backupId: string): Promise<void> {
    const claimed = await this.prisma.backup.updateMany({ where: { id: backupId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (claimed.count !== 1) return;
    const dir = join(this.config.env.TMP_DIR, 'backups');
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `adpilot-db-${stamp}.dump`);
    const key = `backups/database/adpilot-db-${stamp}.dump`;
    try {
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
      await this.prisma.backup.update({ where: { id: backupId }, data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000), finishedAt: new Date() } });
      await this.systemLog.error('backup', `Database backup failed: ${(err as Error).message}`);
      throw err;
    } finally {
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
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}: ${stderr.slice(0, 500)}`))));
    });
  }

  private async prune(): Promise<void> {
    const { keepLast } = await this.settings.get('backups');
    const old = await this.prisma.backup.findMany({ where: { status: 'SUCCESS' }, orderBy: { startedAt: 'desc' }, skip: keepLast });
    for (const b of old) {
      if (b.storageKey) await this.storage.delete(b.storageKey, this.bucket).catch(() => undefined);
      await this.prisma.backup.delete({ where: { id: b.id } });
    }
  }
}
