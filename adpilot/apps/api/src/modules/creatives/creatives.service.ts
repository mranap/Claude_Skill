import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { paginationQuerySchema } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService, ObjectNotFoundError } from '../storage/storage.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Prisma, type CreativeFile, type CreativeMetaAsset } from '../../generated/prisma/client';

export const creativeListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['IMAGE', 'VIDEO']).optional(),
  tag: z.string().trim().max(50).optional(),
});

export const creativeUpdateSchema = z.object({
  originalName: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});

const MB = 1024 * 1024;

@Injectable()
export class CreativesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, q: z.infer<typeof creativeListQuerySchema>) {
    const where: Prisma.CreativeFileWhereInput = {
      userId,
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.q
        ? { OR: [{ originalName: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q } }] }
        : {}),
    };
    const [field, dir] = (q.sort ?? 'createdAt:desc').split(':') as [string, 'asc' | 'desc'];
    const sortable = new Set(['createdAt', 'originalName', 'sizeBytes', 'durationMs']);
    const [rows, total] = await Promise.all([
      this.prisma.creativeFile.findMany({
        where,
        orderBy: { [sortable.has(field) ? field : 'createdAt']: dir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          metaAssets: { include: { adAccount: { select: { id: true, name: true, metaAccountId: true } } } },
        },
      }),
      this.prisma.creativeFile.count({ where }),
    ]);
    return { items: rows.map((r) => this.toDto(r, r.metaAssets)), total, page: q.page, pageSize: q.pageSize };
  }

  async findOwned(userId: string, id: string) {
    const row = await this.prisma.creativeFile.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        metaAssets: { include: { adAccount: { select: { id: true, name: true, metaAccountId: true } } } },
      },
    });
    if (!row) throw AppError.notFound('Creative');
    return row;
  }

  async get(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    return this.toDto(row, row.metaAssets);
  }

  async update(userId: string, id: string, input: z.infer<typeof creativeUpdateSchema>) {
    await this.findOwned(userId, id);
    const row = await this.prisma.creativeFile.update({ where: { id }, data: input });
    return this.toDto(row);
  }

  /** Soft delete; object storage is purged by the retention job. Storage quota is released immediately. */
  async remove(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    const deleted = await this.prisma.creativeFile.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (deleted.count === 1) {
      await this.prisma
        .$executeRaw`UPDATE users SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${row.sizeBytes}) WHERE id = ${userId}::uuid`;
      await this.audit.log({
        action: 'creative.deleted',
        actorUserId: userId,
        subjectUserId: userId,
        targetType: 'creative',
        targetId: id,
        metadata: { name: row.originalName },
      });
    }
  }

  async usage(userId: string) {
    const [user, files] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { storageUsedBytes: true, storageQuotaBytes: true },
      }),
      this.prisma.creativeFile.groupBy({
        by: ['type'],
        where: { userId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const limits = await this.settings.get('files');
    return {
      usedBytes: user.storageUsedBytes.toString(),
      quotaBytes: (user.storageQuotaBytes ?? BigInt(limits.maxUserStorageMb) * BigInt(MB)).toString(),
      images: files.find((f) => f.type === 'IMAGE')?._count._all ?? 0,
      videos: files.find((f) => f.type === 'VIDEO')?._count._all ?? 0,
      limits,
    };
  }

  /** Streams the original file or thumbnail (supports HTTP Range for video seeking). */
  async stream(
    userId: string,
    id: string,
    variant: 'file' | 'thumbnail',
    range: string | undefined,
    res: Response,
  ) {
    const row = await this.findOwned(userId, id);
    const key = variant === 'thumbnail' ? row.thumbnailKey : row.storageKey;
    if (!key) throw AppError.notFound('Preview');
    const validRange = range && /^bytes=\d*-\d*$/.test(range) ? range : undefined;
    const obj = await this.storage
      .getStream(key, variant === 'file' ? validRange : undefined)
      .catch((err: unknown) => {
        throw err instanceof ObjectNotFoundError
          ? AppError.notFound(variant === 'thumbnail' ? 'Preview' : 'File')
          : err;
      });
    res.setHeader('Content-Type', variant === 'thumbnail' ? 'image/jpeg' : row.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.originalName)}"`);
    if (variant === 'file') res.setHeader('Accept-Ranges', 'bytes');
    if (obj.contentRange) {
      res.status(206);
      res.setHeader('Content-Range', obj.contentRange);
    }
    if (obj.contentLength !== undefined) res.setHeader('Content-Length', String(obj.contentLength));
    obj.body.pipe(res);
  }

  /** Makes sure the creative exists in the ad account's Meta library (upload job, idempotent). */
  async ensureMetaAsset(
    userId: string,
    creativeFileId: string,
    adAccountId: string,
  ): Promise<CreativeMetaAsset> {
    const account = await this.prisma.adAccount.findFirst({ where: { id: adAccountId, userId } });
    if (!account) throw AppError.notFound('Ad account');
    const asset = await this.prisma.creativeMetaAsset.upsert({
      where: { creativeFileId_adAccountId: { creativeFileId, adAccountId } },
      create: { userId, creativeFileId, adAccountId },
      update: {},
    });
    if (asset.status !== 'READY') {
      if (asset.status === 'FAILED')
        await this.prisma.creativeMetaAsset.update({
          where: { id: asset.id },
          data: { status: 'PENDING', error: null },
        });
      // Job ids are unique per request; the processor serialises work per asset with a lock and skips READY assets.
      await this.queue.add(
        QUEUES.CREATIVE_UPLOAD,
        JOBS.CREATIVE_UPLOAD,
        { creativeMetaAssetId: asset.id, userId },
        { jobId: jobId('creative-upload', asset.id, Math.floor(Date.now() / 10_000)), attempts: 5 },
      );
    }
    return asset;
  }

  toDto(
    r: CreativeFile,
    assets?: (CreativeMetaAsset & { adAccount?: { id: string; name: string; metaAccountId: string } })[],
  ) {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      name: r.originalName,
      mimeType: r.mimeType,
      extension: r.extension,
      sizeBytes: r.sizeBytes.toString(),
      width: r.width,
      height: r.height,
      durationMs: r.durationMs,
      aspectRatio: r.aspectRatio,
      videoCodec: r.videoCodec,
      audioCodec: r.audioCodec,
      frameRate: r.frameRate ? Number(r.frameRate) : null,
      tags: r.tags,
      createdAt: r.createdAt,
      previewUrl: r.thumbnailKey ? `/api/creatives/${r.id}/thumbnail` : null,
      fileUrl: `/api/creatives/${r.id}/file`,
      metaAssets: (assets ?? []).map((a) => ({
        adAccountId: a.adAccountId,
        adAccountName: a.adAccount?.name,
        metaAccountId: a.adAccount?.metaAccountId,
        status: a.status,
        metaImageHash: a.metaImageHash,
        metaVideoId: a.metaVideoId,
        error: a.error,
        readyAt: a.readyAt,
      })),
    };
  }
}
