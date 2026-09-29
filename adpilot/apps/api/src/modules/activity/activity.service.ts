import { Injectable } from '@nestjs/common';
import type { EntityLevel } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppLogger } from '../../infra/logger/logger';
import { Prisma } from '../../generated/prisma/client';

export type ActivityType =
  | 'CAMPAIGN_CREATED'
  | 'LAUNCH_COMPLETED'
  | 'LAUNCH_FAILED'
  | 'STARTED'
  | 'PAUSED'
  | 'BUDGET_CHANGED'
  | 'RULE_TRIGGERED'
  | 'STATUS_CHANGED'
  | 'ACCOUNT_STATUS_CHANGED'
  | 'TOKEN_STATUS_CHANGED'
  | 'AD_REJECTED'
  | 'SYNC_FAILED';

export interface ActivityInput {
  userId: string;
  type: ActivityType;
  title: string;
  source: 'USER' | 'RULE' | 'SYSTEM' | 'META_SYNC' | 'LAUNCH';
  adAccountId?: string | null;
  entityLevel?: EntityLevel | null;
  entityMetaId?: string | null;
  entityName?: string | null;
  actorUserId?: string | null;
  details?: Record<string, unknown>;
}

/** Activity timeline (campaign / ad account history, dashboard "recent events"). */
@Injectable()
export class ActivityService {
  private readonly logger = new AppLogger('Activity');

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ActivityInput): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title.slice(0, 300),
          source: input.source,
          adAccountId: input.adAccountId ?? null,
          entityLevel: input.entityLevel ?? null,
          entityMetaId: input.entityMetaId ?? null,
          entityName: input.entityName ?? null,
          actorUserId: input.actorUserId ?? null,
          details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.error('Failed to record activity', { err, type: input.type });
    }
  }

  async list(
    userId: string,
    filter: { adAccountId?: string; entityMetaIds?: string[]; page: number; pageSize: number },
  ) {
    const where: Prisma.ActivityEventWhereInput = {
      userId,
      ...(filter.adAccountId ? { adAccountId: filter.adAccountId } : {}),
      ...(filter.entityMetaIds?.length ? { entityMetaId: { in: filter.entityMetaIds } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.activityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.activityEvent.count({ where }),
    ]);
    return { items, total, page: filter.page, pageSize: filter.pageSize };
  }
}
