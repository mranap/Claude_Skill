import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { draftSaveSchema, paginationQuerySchema, templateConfigSchema } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Prisma } from '../../generated/prisma/client';

const MAX_DRAFT_BYTES = 512 * 1024;

/** Campaign drafts: a launch configuration saved step by step and resumed later. */
@Injectable()
export class DraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, q: z.infer<typeof paginationQuerySchema> & { status?: 'DRAFT' | 'LAUNCHED' | 'ARCHIVED' }) {
    const where: Prisma.LaunchDraftWhereInput = {
      userId,
      status: q.status ?? 'DRAFT',
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.launchDraft.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { template: { select: { id: true, name: true } } },
      }),
      this.prisma.launchDraft.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        template: r.template,
        profileId: r.profileId,
        adAccountId: r.adAccountId,
        variants: Array.isArray((r.config as { variants?: unknown[] }).variants) ? (r.config as { variants: unknown[] }).variants.length : 0,
        lastValidatedAt: r.lastValidatedAt,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async findOwned(userId: string, id: string) {
    const row = await this.prisma.launchDraft.findFirst({ where: { id, userId } });
    if (!row) throw AppError.notFound('Draft');
    return row;
  }

  async create(userId: string, input: z.infer<typeof draftSaveSchema>) {
    await this.assertRefs(userId, input);
    this.assertSize(input.config);
    const row = await this.prisma.launchDraft.create({
      data: {
        userId,
        name: input.name,
        templateId: input.templateId ?? null,
        profileId: input.profileId ?? null,
        adAccountId: input.adAccountId ?? null,
        config: input.config as Prisma.InputJsonValue,
      },
    });
    return row;
  }

  /** Starts a draft pre-filled from a template (settings + predefined language/geo groups). */
  async fromTemplate(userId: string, templateId: string) {
    const tpl = await this.prisma.campaignTemplate.findFirst({ where: { id: templateId, userId } });
    if (!tpl) throw AppError.notFound('Template');
    const parsed = templateConfigSchema.safeParse(tpl.config);
    if (!parsed.success) throw AppError.validation('The template is invalid; open and save it again');
    const row = await this.prisma.launchDraft.create({
      data: {
        userId,
        name: tpl.name,
        templateId: tpl.id,
        config: { version: 1, templateId: tpl.id, name: tpl.name, settings: parsed.data.settings, variants: parsed.data.variants } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.campaignTemplate.update({ where: { id: tpl.id }, data: { lastUsedAt: new Date() } });
    return row;
  }

  async update(userId: string, id: string, input: z.infer<typeof draftSaveSchema>) {
    const draft = await this.findOwned(userId, id);
    if (draft.status !== 'DRAFT') throw AppError.conflict('This draft was already launched; clone it to make changes');
    await this.assertRefs(userId, input);
    this.assertSize(input.config);
    return this.prisma.launchDraft.update({
      where: { id },
      data: {
        name: input.name,
        templateId: input.templateId ?? null,
        profileId: input.profileId ?? null,
        adAccountId: input.adAccountId ?? null,
        config: input.config as Prisma.InputJsonValue,
      },
    });
  }

  async clone(userId: string, id: string) {
    const src = await this.findOwned(userId, id);
    const row = await this.prisma.launchDraft.create({
      data: {
        userId,
        name: `${src.name} (copy)`.slice(0, 150),
        templateId: src.templateId,
        profileId: src.profileId,
        adAccountId: src.adAccountId,
        config: src.config as Prisma.InputJsonValue,
        clonedFromId: src.id,
      },
    });
    await this.audit.log({ action: 'draft.cloned', actorUserId: userId, subjectUserId: userId, targetType: 'draft', targetId: row.id, metadata: { from: id } });
    return row;
  }

  async archive(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.launchDraft.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  private assertSize(config: unknown) {
    if (Buffer.byteLength(JSON.stringify(config)) > MAX_DRAFT_BYTES) throw AppError.validation('The draft is too large');
  }

  /** Referenced template/profile/account must belong to the user (no cross-tenant references). */
  private async assertRefs(userId: string, input: z.infer<typeof draftSaveSchema>) {
    if (input.templateId && !(await this.prisma.campaignTemplate.count({ where: { id: input.templateId, userId } }))) throw AppError.notFound('Template');
    if (input.profileId && !(await this.prisma.metaProfile.count({ where: { id: input.profileId, userId, deletedAt: null } }))) throw AppError.notFound('Meta profile');
    if (input.adAccountId && !(await this.prisma.adAccount.count({ where: { id: input.adAccountId, userId } }))) throw AppError.notFound('Ad account');
  }
}
