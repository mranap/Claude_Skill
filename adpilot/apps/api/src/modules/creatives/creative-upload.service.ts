import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import busboy from 'busboy';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Transform, TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { META_MEDIA_LIMITS } from '@adpilot/shared';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../infra/logger/logger';
import { MediaProbeService, MediaValidationError, ProbeResult } from './media-probe.service';
import { CreativesService } from './creatives.service';

const MB = 1024 * 1024;
const IMAGE_EXT = new Set<string>(META_MEDIA_LIMITS.image.extensions);
const VIDEO_EXT = new Set<string>(META_MEDIA_LIMITS.video.extensions);
const IMAGE_MIME = new Set<string>([...META_MEDIA_LIMITS.image.mimeTypes, 'image/jpg', 'image/pjpeg']);
const VIDEO_MIME = new Set<string>([...META_MEDIA_LIMITS.video.mimeTypes, 'application/octet-stream']);
/** Uploads a user may stream at the same time (each can be several GB on disk until it is processed). */
const MAX_CONCURRENT_UPLOADS = 3;
/** Temporary upload files older than this belong to requests that can no longer be running. */
const STALE_TMP_MS = 6 * 3600_000;

/**
 * Counts bytes and computes SHA-256. When the file exceeds the per-file size limit or the request's share of
 * the remaining storage quota (`budget`, shared by all files of one request), nothing more is written and the
 * rest of the file is read and discarded. (Failing the stream instead would destroy busboy's file stream, and
 * busboy then waits forever for it to be read: the whole request would hang.)
 */
class HashingLimiter extends Transform {
  readonly hash = createHash('sha256');
  bytes = 0;
  exceeded: 'size' | 'quota' | null = null;
  constructor(
    private readonly limit: number,
    private readonly budget: { left: number },
  ) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.exceeded) return cb();
    this.bytes += chunk.length;
    this.budget.left -= chunk.length;
    this.exceeded = this.bytes > this.limit ? 'size' : this.budget.left < 0 ? 'quota' : null;
    if (this.exceeded) {
      this.budget.left += this.bytes; // a rejected file uses no quota
      return cb();
    }
    this.hash.update(chunk);
    cb(null, chunk);
  }
}

interface ReceivedFile {
  originalName: string;
  declaredMime: string;
  ext: string;
  kind: 'IMAGE' | 'VIDEO';
  tmpPath: string;
  size: number;
  sha256: string;
}

export interface UploadItemResult {
  originalName: string;
  ok: boolean;
  duplicate?: boolean;
  file?: ReturnType<CreativesService['toDto']>;
  warnings?: string[];
  error?: string;
}

@Injectable()
export class CreativeUploadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('CreativeUpload');
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly probe: MediaProbeService,
    private readonly audit: AuditService,
    private readonly creatives: CreativesService,
  ) {}

  private get tmpDir(): string {
    return join(this.config.env.TMP_DIR, 'uploads');
  }

  onModuleInit(): void {
    // Files of uploads interrupted by a crash or restart are never finished; remove them now and hourly.
    void this.sweepTmp();
    this.sweepTimer = setInterval(() => void this.sweepTmp(), 3600_000);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private async sweepTmp(): Promise<void> {
    try {
      const names = await readdir(this.tmpDir).catch(() => [] as string[]);
      for (const name of names) {
        const path = join(this.tmpDir, name);
        const info = await stat(path).catch(() => null);
        if (info && Date.now() - info.mtimeMs > STALE_TMP_MS)
          await rm(path, { force: true, recursive: true });
      }
    } catch (err) {
      this.logger.warn('Temporary upload sweep failed', { err: String(err) });
    }
  }

  async handle(req: Request, userId: string): Promise<{ results: UploadItemResult[] }> {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.startsWith('multipart/form-data'))
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data');
    const limits = await this.settings.get('files');
    const maxImage = Math.min(limits.maxImageSizeMb, limits.maxUploadSizeMb) * MB;
    const maxVideo = Math.min(limits.maxVideoSizeMb, limits.maxUploadSizeMb) * MB;
    // Nothing is written to disk beyond the remaining quota: checked up front from Content-Length and again
    // while streaming (the atomic reservation in finalize() stays authoritative).
    const remaining = await this.remainingQuota(userId);
    const declared = Number(req.headers['content-length'] ?? 0);
    if (remaining <= 0 || (declared > 0 && declared > remaining + MB)) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        'This upload does not fit into your remaining storage. Delete unused creatives or ask the administrator for more space.',
      );
    }
    const active = this.redis.key('creative-uploads', userId);
    const running = await this.redis.client.incr(active);
    await this.redis.client.pexpire(active, 3 * 3600_000);
    try {
      if (running > MAX_CONCURRENT_UPLOADS) {
        throw AppError.rateLimited(
          30,
          `At most ${MAX_CONCURRENT_UPLOADS} uploads can run at the same time. Wait for the others to finish.`,
        );
      }
      await mkdir(this.tmpDir, { recursive: true });
      return await this.receiveAndProcess(req, userId, {
        maxImage,
        maxVideo,
        maxFiles: limits.maxFilesPerUpload,
        budget: { left: remaining },
      });
    } finally {
      if ((await this.redis.client.decr(active)) <= 0) await this.redis.client.del(active);
    }
  }

  private async receiveAndProcess(
    req: Request,
    userId: string,
    opts: { maxImage: number; maxVideo: number; maxFiles: number; budget: { left: number } },
  ): Promise<{ results: UploadItemResult[] }> {
    const received: ReceivedFile[] = [];
    const rejected: UploadItemResult[] = [];
    const pending: Promise<void>[] = [];
    try {
      const bb = busboy({
        headers: req.headers,
        limits: {
          files: opts.maxFiles,
          fields: 5,
          parts: opts.maxFiles + 5,
          fileSize: Math.max(opts.maxImage, opts.maxVideo) + 1,
        },
      });
      bb.on('file', (_field, stream, info) => {
        const originalName = (info.filename || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
        const ext = extname(originalName).slice(1).toLowerCase();
        const kind = IMAGE_EXT.has(ext) ? 'IMAGE' : VIDEO_EXT.has(ext) ? 'VIDEO' : null;
        const mimeOk =
          kind === 'IMAGE'
            ? IMAGE_MIME.has(info.mimeType)
            : kind === 'VIDEO'
              ? VIDEO_MIME.has(info.mimeType)
              : false;
        if (!kind || !mimeOk) {
          stream.resume();
          rejected.push({
            originalName,
            ok: false,
            error: `Unsupported file type. Images: ${[...IMAGE_EXT].join(', ').toUpperCase()}; videos: ${[...VIDEO_EXT].join(', ').toUpperCase()}.`,
          });
          return;
        }
        const limit = kind === 'IMAGE' ? opts.maxImage : opts.maxVideo;
        const tmpPath = join(this.tmpDir, `${randomUUID()}.${ext}`);
        const limiter = new HashingLimiter(limit, opts.budget);
        pending.push(
          pipeline(stream, limiter, createWriteStream(tmpPath))
            .then(async () => {
              if (!limiter.exceeded) {
                received.push({
                  originalName,
                  declaredMime: info.mimeType,
                  ext,
                  kind,
                  tmpPath,
                  size: limiter.bytes,
                  sha256: limiter.hash.digest('hex'),
                });
                return;
              }
              await rm(tmpPath, { force: true });
              rejected.push({
                originalName,
                ok: false,
                error:
                  limiter.exceeded === 'size'
                    ? `File is larger than the ${Math.round(limit / MB)} MB limit for ${kind === 'IMAGE' ? 'images' : 'videos'}.`
                    : 'This file does not fit into your remaining storage.',
              });
            })
            .catch(async (err: unknown) => {
              // The file stream is gone (client disconnected, disk error): the request cannot complete.
              bb.destroy(err instanceof Error ? err : new Error('Upload interrupted'));
              await rm(tmpPath, { force: true });
            }),
        );
      });
      bb.on('filesLimit', () =>
        rejected.push({ originalName: '…', ok: false, error: `At most ${opts.maxFiles} files per upload.` }),
      );
      // pipeline() (unlike req.pipe) destroys the parser when the client disconnects, which ends every open
      // file stream with an error, so their temporary files are removed and the request settles.
      await pipeline(req, bb);
      await Promise.all(pending);
    } catch (err) {
      await Promise.allSettled(pending);
      await Promise.all(received.map((f) => rm(f.tmpPath, { force: true })));
      if (err instanceof AppError) throw err;
      throw new AppError('BAD_REQUEST', 'The upload was interrupted. Please try again.');
    }

    const results: UploadItemResult[] = [...rejected];
    for (const file of received) {
      try {
        results.push(await this.finalize(userId, file));
      } catch (err) {
        const message =
          err instanceof MediaValidationError || err instanceof AppError
            ? err.message
            : 'Processing failed. Try another file.';
        if (!(err instanceof MediaValidationError) && !(err instanceof AppError))
          this.logger.error('Creative processing failed', { err });
        results.push({ originalName: file.originalName, ok: false, error: message });
      } finally {
        await rm(file.tmpPath, { force: true });
      }
    }
    return { results };
  }

  private async finalize(userId: string, file: ReceivedFile): Promise<UploadItemResult> {
    const existing = await this.prisma.creativeFile.findFirst({
      where: { userId, sha256: file.sha256, deletedAt: null },
    });
    if (existing)
      return {
        originalName: file.originalName,
        ok: true,
        duplicate: true,
        file: this.creatives.toDto(existing),
      };

    const probe: ProbeResult =
      file.kind === 'IMAGE'
        ? await this.probe.probeImage(file.tmpPath)
        : await this.probe.probeVideo(file.tmpPath);
    const actualSize = (await stat(file.tmpPath)).size;
    await this.reserveQuota(userId, actualSize);

    const id = randomUUID();
    const ext = probe.format === 'jpeg' ? 'jpg' : probe.format;
    const storageKey = `u/${userId}/c/${id}/original.${ext}`;
    const thumbKey = `u/${userId}/c/${id}/thumb.jpg`;
    try {
      await this.storage.uploadFile(storageKey, file.tmpPath, probe.mimeType);
      let thumbnailKey: string | null = null;
      try {
        const thumb =
          file.kind === 'IMAGE'
            ? await this.probe.imageThumbnail(file.tmpPath)
            : await this.probe.videoThumbnail(
                file.tmpPath,
                probe.durationMs ?? 0,
                `${file.tmpPath}.thumb.jpg`,
              );
        await this.storage.uploadBuffer(thumbKey, thumb, 'image/jpeg');
        thumbnailKey = thumbKey;
      } catch (err) {
        this.logger.warn('Thumbnail generation failed', { err: String(err) });
      } finally {
        await rm(`${file.tmpPath}.thumb.jpg`, { force: true });
      }
      const row = await this.prisma.creativeFile.create({
        data: {
          id,
          userId,
          type: file.kind,
          status: 'READY',
          originalName: file.originalName,
          storageKey,
          thumbnailKey,
          mimeType: probe.mimeType,
          extension: ext,
          sizeBytes: BigInt(actualSize),
          sha256: file.sha256,
          width: probe.width,
          height: probe.height,
          durationMs: probe.durationMs ?? null,
          aspectRatio: probe.aspectRatio,
          videoCodec: probe.videoCodec ?? null,
          audioCodec: probe.audioCodec ?? null,
          frameRate: probe.frameRate ?? null,
          bitrate: probe.bitrate ?? null,
        },
      });
      await this.audit.log({
        action: 'creative.uploaded',
        actorUserId: userId,
        subjectUserId: userId,
        targetType: 'creative',
        targetId: id,
        metadata: { name: file.originalName, type: file.kind, size: actualSize },
      });
      return {
        originalName: file.originalName,
        ok: true,
        file: this.creatives.toDto(row),
        warnings: probe.warnings,
      };
    } catch (err) {
      await this.releaseQuota(userId, actualSize);
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  private async remainingQuota(userId: string): Promise<number> {
    const { maxUserStorageMb } = await this.settings.get('files');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { storageUsedBytes: true, storageQuotaBytes: true },
    });
    const quota = user.storageQuotaBytes ?? BigInt(maxUserStorageMb) * BigInt(MB);
    return Number(quota - user.storageUsedBytes);
  }

  /** Atomically reserves storage (per-user override or the global limit). */
  private async reserveQuota(userId: string, bytes: number): Promise<void> {
    const { maxUserStorageMb } = await this.settings.get('files');
    const globalQuota = BigInt(maxUserStorageMb) * BigInt(MB);
    const size = BigInt(bytes);
    const updated = await this.prisma.$executeRaw`
      UPDATE users SET "storageUsedBytes" = "storageUsedBytes" + ${size}
      WHERE id = ${userId}::uuid AND "storageUsedBytes" + ${size} <= COALESCE("storageQuotaBytes", ${globalQuota})`;
    if (updated !== 1)
      throw new AppError(
        'QUOTA_EXCEEDED',
        'Your storage quota is full. Delete unused creatives or ask the administrator for more space.',
      );
  }

  private async releaseQuota(userId: string, bytes: number): Promise<void> {
    await this.prisma
      .$executeRaw`UPDATE users SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${BigInt(bytes)}) WHERE id = ${userId}::uuid`;
  }
}
