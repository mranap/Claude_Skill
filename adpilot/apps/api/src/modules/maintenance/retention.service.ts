import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SystemLogService } from '../system-log/system-log.service';
import { QueueService } from '../../infra/queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { AppLogger } from '../../infra/logger/logger';

const DAY = 86400_000;
/** Prisma's interactive-transaction defaults (2 s to get a connection, 5 s to finish) are too tight for a batch. */
const AUDIT_BATCH_TX = { maxWait: 30_000, timeout: 60_000 };

/**
 * Deletes data older than the retention periods configured by the Super Admin, in bounded batches so a
 * large backlog never locks tables for long. Also purges files of deleted creatives from object storage.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new AppLogger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly systemLog: SystemLogService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
  ) {}

  async run(): Promise<Record<string, number>> {
    const r = await this.settings.get('retention');
    const before = (days: number) => new Date(Date.now() - days * DAY);
    const result: Record<string, number> = {};
    const failed: string[] = [];
    // Each step runs on its own: one failing table must not skip the cleanup of the others.
    const step = async (name: string, fn: () => Promise<number>) => {
      try {
        result[name] = await fn();
      } catch (err) {
        failed.push(name);
        await this.systemLog.error('retention', `Retention step "${name}" failed: ${(err as Error).message}`, { step: name });
      }
    };

    await step('metaApiLogs', () => this.batchDelete('meta_api_logs', '"createdAt"', before(r.metaApiLogsDays)));
    await step('systemLogs', () => this.batchDelete('system_logs', '"createdAt"', before(r.systemLogsDays)));
    await step('auditLogs', () => this.batchDelete('audit_logs', '"createdAt"', before(r.auditLogsDays)));
    await step('notifications', () => this.batchDelete('notifications', '"createdAt"', before(r.notificationsDays)));
    await step('loginEvents', () => this.batchDelete('login_events', '"createdAt"', before(r.loginEventsDays)));
    await step('statistics', () => this.batchDelete('insights_daily', '"date"', before(r.statisticsDays)));
    await step('ruleExecutions', () => this.batchDelete('auto_rule_executions', '"executedAt"', before(r.ruleExecutionsDays)));
    await step('launchJobs', () =>
      this.batchDelete('launch_jobs', '"createdAt"', before(r.launchJobsDays), `AND status IN ('COMPLETED','PARTIAL_FAILURE','FAILED','CANCELLED')`),
    );
    await step('expiredSessions', () => this.batchDelete('sessions', '"expiresAt"', before(7)));
    await step('resetTokens', () => this.batchDelete('password_reset_tokens', '"expiresAt"', before(1)));
    await step('emailTokens', () => this.batchDelete('email_change_tokens', '"expiresAt"', before(1)));
    await step('telegramCodes', () => this.batchDelete('telegram_link_codes', '"expiresAt"', before(1)));
    await step('purgedFiles', () => this.purgeDeletedFiles());

    // Finished BullMQ jobs beyond the configured age.
    const graceMs = r.completedQueueJobsHours * 3600_000;
    for (const { queue } of this.queue.all()) {
      await queue.clean(graceMs, 5000, 'completed').catch(() => undefined);
    }
    if (failed.length) {
      await this.systemLog.warn('retention', 'Retention cleanup finished with errors', { ...result, failed });
      // The job fails, so the queue retries it (the finished steps have nothing left to delete).
      throw new Error(`Retention steps failed: ${failed.join(', ')}`);
    }
    await this.systemLog.info('retention', 'Retention cleanup finished', result);
    return result;
  }

  private async batchDelete(table: string, column: string, olderThan: Date, extraWhere = ''): Promise<number> {
    const sql = `DELETE FROM "${table}" WHERE id IN (SELECT id FROM "${table}" WHERE ${column} < $1 ${extraWhere} LIMIT 5000)`;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const deleted =
        table === 'audit_logs'
          ? // The audit log trigger rejects every DELETE except inside a transaction marked as retention.
            await this.prisma.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT set_config('adpilot.audit_retention', 'on', true)`;
              return tx.$executeRawUnsafe(sql, olderThan);
            }, AUDIT_BATCH_TX)
          : await this.prisma.$executeRawUnsafe(sql, olderThan);
      total += deleted;
      if (deleted < 5000) break;
    }
    return total;
  }

  /** Removes objects of creatives that were deleted more than 24 h ago. */
  private async purgeDeletedFiles(): Promise<number> {
    const files = await this.prisma.creativeFile.findMany({
      where: { deletedAt: { lt: new Date(Date.now() - DAY) } },
      select: { id: true, storageKey: true, thumbnailKey: true },
      take: 1000,
    });
    let purged = 0;
    for (const f of files) {
      try {
        await this.storage.delete(f.storageKey);
        if (f.thumbnailKey) await this.storage.delete(f.thumbnailKey);
        await this.prisma.creativeFile.delete({ where: { id: f.id } });
        purged++;
      } catch (err) {
        this.logger.warn('Could not purge file', { fileId: f.id, err: String(err) });
      }
    }
    return purged;
  }
}
