import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../../modules/settings/settings.service';
import { SchedulerTask, slot } from '../scheduler-task';

/** Enqueues due automated rules (claimed atomically, deduplicated per minute slot). */
@Injectable()
export class AutoRulesTask implements SchedulerTask {
  readonly name = 'auto-rules';
  readonly everyMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    const { minCheckIntervalMinutes } = await this.settings.get('rules');
    const rows = await this.prisma.$queryRaw<{ id: string; userId: string }[]>`
      UPDATE auto_rules SET "nextRunAt" = now() + make_interval(mins => GREATEST("checkIntervalMinutes", ${minCheckIntervalMinutes}::int))
      WHERE id IN (
        SELECT r.id FROM auto_rules r JOIN users u ON u.id = r."userId"
        WHERE r."isActive" AND r."deletedAt" IS NULL AND u.status = 'ACTIVE'
          AND r."nextRunAt" IS NOT NULL AND r."nextRunAt" <= now()
        ORDER BY r."nextRunAt" LIMIT 500
        FOR UPDATE OF r SKIP LOCKED)
      RETURNING id, "userId"`;
    const s = slot(new Date(), 60_000);
    for (const r of rows) {
      await this.queue.add(QUEUES.AUTO_RULES, JOBS.AUTO_RULE_CHECK, { ruleId: r.id, userId: r.userId, slot: s }, { jobId: jobId('rule', r.id, s), attempts: 3 });
    }
  }
}
