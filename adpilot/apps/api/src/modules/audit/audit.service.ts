import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RequestContext } from '../../common/context/request-context';
import { sanitize } from '../../infra/logger/sanitize';
import { AppLogger } from '../../infra/logger/logger';
import { Prisma } from '../../generated/prisma/client';

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorType?: 'USER' | 'SYSTEM';
  targetType?: string;
  targetId?: string;
  subjectUserId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only audit trail. Rows are never updated (a database trigger rejects UPDATE statements) and are
 * only removed by the retention job configured by the Super Admin. Metadata is sanitized before storage.
 */
@Injectable()
export class AuditService {
  private readonly logger = new AppLogger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    const ctx = RequestContext.get();
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorType: entry.actorType ?? (entry.actorUserId || ctx?.userId ? 'USER' : 'SYSTEM'),
          actorUserId: entry.actorUserId ?? ctx?.userId ?? null,
          actorEmail: entry.actorEmail ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          subjectUserId: entry.subjectUserId ?? null,
          ip: entry.ip ?? ctx?.ip ?? null,
          userAgent: (entry.userAgent ?? ctx?.userAgent ?? null)?.slice(0, 500) ?? null,
          metadata: entry.metadata ? (sanitize(entry.metadata) as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (err) {
      // Audit failures must be visible but must not break the user's request.
      this.logger.error('Failed to write audit log', { err, action: entry.action });
    }
  }
}
