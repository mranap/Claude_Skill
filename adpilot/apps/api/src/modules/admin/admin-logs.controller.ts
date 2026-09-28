import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { META_ERROR_CATEGORIES, auditQuerySchema, logsQuerySchema, metaApiLogsQuerySchema } from '@adpilot/shared';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
}

/** Read-only access to the audit trail, system logs and Meta API technical logs. */
@Controller('admin')
export class AdminLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('audit')
  @RequirePermissions('admin.audit.view')
  async audit(@Query(zod(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.subjectUserId ? { subjectUserId: q.subjectUserId } : {}),
      ...(dateRange(q.from, q.to) ? { createdAt: dateRange(q.from, q.to) } : {}),
      ...(q.q ? { OR: [{ actorEmail: { contains: q.q, mode: 'insensitive' } }, { targetId: q.q }, { action: { contains: q.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    const userIds = [...new Set(items.flatMap((i) => [i.actorUserId, i.subjectUserId]).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } });
    const emails = new Map(users.map((u) => [u.id, u.email]));
    return {
      items: items.map((i) => ({
        ...i,
        actorLabel: i.actorEmail ?? (i.actorUserId ? emails.get(i.actorUserId) : null) ?? (i.actorType === 'SYSTEM' ? 'system' : null),
        subjectLabel: i.subjectUserId ? emails.get(i.subjectUserId) ?? null : null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  @Get('logs')
  @RequirePermissions('admin.logs.view')
  async systemLogs(@Query(zod(logsQuerySchema)) q: z.infer<typeof logsQuerySchema>) {
    const where: Prisma.SystemLogWhereInput = {
      ...(q.level ? { level: q.level } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(dateRange(q.from, q.to) ? { createdAt: dateRange(q.from, q.to) } : {}),
      ...(q.q ? { message: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.systemLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.systemLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Get('meta-api-logs')
  @RequirePermissions('admin.logs.view')
  async metaLogs(@Query(zod(metaApiLogsQuerySchema)) q: z.infer<typeof metaApiLogsQuerySchema>) {
    // Each filter is its own AND clause (two OR groups must not overwrite each other).
    const and: Prisma.MetaApiLogWhereInput[] = [];
    if (q.userId) and.push({ userId: q.userId });
    if (q.onlyErrors) and.push({ OR: [{ errorCode: { not: null } }, { httpStatus: { gte: 400 } }] });
    if (q.category) and.push({ category: { startsWith: q.category } });
    const created = dateRange(q.from, q.to);
    if (created) and.push({ createdAt: created });
    if (q.q) and.push({ OR: [{ metaAccountId: q.q }, { fbtraceId: q.q }, { path: { contains: q.q } }, { errorMessage: { contains: q.q, mode: 'insensitive' } }] });
    const where: Prisma.MetaApiLogWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await Promise.all([
      this.prisma.metaApiLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.metaApiLog.count({ where }),
    ]);
    const userIds = [...new Set(items.map((i) => i.userId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } });
    const emails = new Map(users.map((u) => [u.id, u.email]));
    return { items: items.map((i) => ({ ...i, userEmail: i.userId ? emails.get(i.userId) ?? null : null })), total, page: q.page, pageSize: q.pageSize };
  }

  /** Values for the log filters (system log sources seen so far, Meta call categories and error categories). */
  @Get('logs/sources')
  @RequirePermissions('admin.logs.view')
  async logSources() {
    const [sources, categories] = await Promise.all([
      this.prisma.systemLog.findMany({ distinct: ['source'], select: { source: true }, orderBy: { source: 'asc' }, take: 200 }),
      this.prisma.metaApiLog.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' }, take: 500 }),
    ]);
    return {
      systemSources: sources.map((s) => s.source),
      metaCategories: [...new Set(categories.map((c) => c.category.split('.')[0]!))],
      errorCategories: META_ERROR_CATEGORIES,
    };
  }
}
