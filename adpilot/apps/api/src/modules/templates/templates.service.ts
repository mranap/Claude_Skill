import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  objectiveRule,
  templateConfigSchema,
  templateCreateSchema,
  templateListQuerySchema,
  templateUpdateSchema,
  type TemplateConfig,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Prisma } from '../../generated/prisma/client';

type ListQuery = z.infer<typeof templateListQuerySchema>;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, q: ListQuery) {
    const where: Prisma.CampaignTemplateWhereInput = {
      userId,
      isArchived: q.archived ?? false,
      ...(q.objective ? { objective: q.objective } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [field, dir] = (q.sort ?? 'updatedAt:desc').split(':') as [string, 'asc' | 'desc'];
    const sortable = new Set(['updatedAt', 'createdAt', 'name', 'lastUsedAt']);
    const [rows, total] = await Promise.all([
      this.prisma.campaignTemplate.findMany({
        where,
        orderBy: { [sortable.has(field) ? field : 'updatedAt']: dir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.campaignTemplate.count({ where }),
    ]);
    return {
      items: rows.map((r) => {
        const cfg = r.config as unknown as TemplateConfig;
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          objective: r.objective,
          objectiveLabel: objectiveRule(r.objective)?.label ?? r.objective,
          destination: cfg.settings?.destination,
          optimizationGoal: cfg.settings?.optimizationGoal,
          budget: cfg.settings?.budget,
          countries: cfg.settings?.targeting?.countries ?? [],
          variantsCount: cfg.variants?.length ?? 0,
          isArchived: r.isArchived,
          lastUsedAt: r.lastUsedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async findOwned(userId: string, id: string) {
    const row = await this.prisma.campaignTemplate.findFirst({ where: { id, userId } });
    if (!row) throw AppError.notFound('Template');
    return row;
  }

  async get(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    return { ...row, config: this.parseStored(row.config) };
  }

  async create(userId: string, input: z.infer<typeof templateCreateSchema>) {
    this.assertCombination(input.config);
    const row = await this.prisma.campaignTemplate.create({
      data: {
        userId,
        name: input.name,
        description: input.description ?? null,
        objective: input.config.settings.objective,
        config: input.config as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({ action: 'template.created', actorUserId: userId, subjectUserId: userId, targetType: 'template', targetId: row.id, metadata: { name: row.name } });
    return this.get(userId, row.id);
  }

  async update(userId: string, id: string, input: z.infer<typeof templateUpdateSchema>) {
    await this.findOwned(userId, id);
    if (input.config) this.assertCombination(input.config);
    await this.prisma.campaignTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        ...(input.config ? { config: input.config as unknown as Prisma.InputJsonValue, objective: input.config.settings.objective } : {}),
      },
    });
    await this.audit.log({ action: 'template.updated', actorUserId: userId, subjectUserId: userId, targetType: 'template', targetId: id });
    return this.get(userId, id);
  }

  async clone(userId: string, id: string) {
    const src = await this.findOwned(userId, id);
    const row = await this.prisma.campaignTemplate.create({
      data: {
        userId,
        name: `${src.name} (copy)`.slice(0, 120),
        description: src.description,
        objective: src.objective,
        config: src.config as Prisma.InputJsonValue,
        clonedFromId: src.id,
      },
    });
    await this.audit.log({ action: 'template.cloned', actorUserId: userId, subjectUserId: userId, targetType: 'template', targetId: row.id, metadata: { from: id } });
    return this.get(userId, row.id);
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    const inUse = await this.prisma.launchJob.count({ where: { templateId: id } });
    if (inUse) {
      await this.prisma.campaignTemplate.update({ where: { id }, data: { isArchived: true } });
    } else {
      await this.prisma.campaignTemplate.delete({ where: { id } });
    }
    await this.audit.log({ action: inUse ? 'template.archived' : 'template.deleted', actorUserId: userId, subjectUserId: userId, targetType: 'template', targetId: id });
    return { archived: inUse > 0, deleted: inUse === 0 };
  }

  /** Stored configs are re-validated on read so older/invalid documents are normalised (defaults applied). */
  parseStored(config: unknown): TemplateConfig | unknown {
    const parsed = templateConfigSchema.safeParse(config);
    return parsed.success ? parsed.data : config;
  }

  private assertCombination(config: TemplateConfig) {
    const rule = objectiveRule(config.settings.objective);
    const dest = rule?.destinations.find((d) => d.destination === config.settings.destination);
    const goal = dest?.goals.find((g) => g.goal === config.settings.optimizationGoal);
    if (!rule || !dest || !goal) {
      throw AppError.validation('This combination of objective, conversion location and optimization goal is not supported', [
        { path: 'config.settings.optimizationGoal', message: 'Choose one of the listed optimization goals' },
      ]);
    }
    if (!goal.billingEvents.includes(config.settings.billingEvent)) {
      throw AppError.validation(`Billing event ${config.settings.billingEvent} is not available for ${goal.label}`, [
        { path: 'config.settings.billingEvent', message: `Allowed: ${goal.billingEvents.join(', ')}` },
      ]);
    }
  }
}
