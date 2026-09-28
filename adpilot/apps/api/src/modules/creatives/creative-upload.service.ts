import { Injectable } from '@nestjs/common';
import busboy from 'busboy';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Transform, TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { META_MEDIA_LIMITS } from '@adpilot/shared';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
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

class SizeLimitError extends Error {}

/** Counts bytes, computes SHA-256 and aborts the stream as soon as the size limit is exceeded. */
class HashingLimiter extends Transform {
  readonly hash = createHash('sha256');
  bytes = 0;
  constructor(private readonly limit: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) return cb(new SizeLimitError());
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
export class CreativeUploadService {
  private readonly logger = new AppLogger('CreativeUpload');

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly probe: MediaProbeService,
    private readonly audit: AuditService,
    private readonly creatives: CreativesService,
  ) {}

  async handle(req: Request, userId: string): Promise<{ results: UploadItemResult[] }> {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.startsWith('multipart/form-data')) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data');
    const limits = await this.settings.get('files');
    const maxImage = Math.min(limits.maxImageSizeMb, limits.maxUploadSizeMb) * MB;
    const maxVideo = Math.min(limits.maxVideoSizeMb, limits.maxUploadSizeMb) * MB;
    const tmpDir = join(this.config.env.TMP_DIR, 'uploads');
    await mkdir(tmpDir, { recursive: true });

    const received: ReceivedFile[] = [];
    const rejected: UploadItemResult[] = [];
    const pending: Promise<void>[] = [];

    await new Promise<void>((resolve, reject) => {
      const bb = busboy({
        headers: req.headers,
        limits: { files: limits.maxFilesPerUpload, fields: 5, parts: limits.maxFilesPerUpload + 5, fileSize: Math.max(maxImage, maxVideo) + 1 },
      });
      bb.on('file', (_field, stream, info) => {
        const originalName = (info.filename || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
        const ext = extname(originalName).slice(1).toLowerCase();
        const kind = IMAGE_EXT.has(ext) ? 'IMAGE' : VIDEO_EXT.has(ext) ? 'VIDEO' : null;
        const mimeOk = kind === 'IMAGE' ? IMAGE_MIME.has(info.mimeType) : kind === 'VIDEO' ? VIDEO_MIME.has(info.mimeType) : false;
        if (!kind || !mimeOk) {
          stream.resume();
          rejected.push({
            originalName,
            ok: false,
            error: `Unsupported file type. Images: ${[...IMAGE_EXT].join(', ').toUpperCase()}; videos: ${[...VIDEO_EXT].join(', ').toUpperCase()}.`,
          });
          return;
        }
        const limit = kind === 'IMAGE' ? maxImage : maxVideo;
        const tmpPath = join(tmpDir, `${randomUUID()}.${ext}`);
        const limiter = new HashingLimiter(limit);
        pending.push(
          pipeline(stream, limiter, createWriteStream(tmpPath))
            .then(() => {
              received.push({ originalName, declaredMime: info.mimeType, ext, kind, tmpPath, size: limiter.bytes, sha256: limiter.hash.digest('hex') });
            })
            .catch(async (err) => {
              stream.resume();
              await rm(tmpPath, { force: true });
              rejected.push({
                originalName,
                ok: false,
                error: err instanceof SizeLimitError ? `File is larger than the ${Math.round(limit / MB)} MB limit for ${kind === 'IMAGE' ? 'images' : 'videos'}.` : 'Upload interrupted.',
              });
            }),
        );
      });
      bb.on('filesLimit', () => rejected.push({ originalName: '…', ok: false, error: `At most ${limits.maxFilesPerUpload} files per upload.` }));
      bb.on('error', reject);
      bb.on('close', () => resolve());
      req.pipe(bb);
    });
    await Promise.all(pending);

    const results: UploadItemResult[] = [...rejected];
    for (const file of received) {
      try {
        results.push(await this.finalize(userId, file));
      } catch (err) {
        const message = err instanceof MediaValidationError || err instanceof AppError ? err.message : 'Processing failed. Try another file.';
        if (!(err instanceof MediaValidationError) && !(err instanceof AppError)) this.logger.error('Creative processing failed', { err });
        results.push({ originalName: file.originalName, ok: false, error: message });
      } finally {
        await rm(file.tmpPath, { force: true });
      }
    }
    return { results };
  }

  private async finalize(userId: string, file: ReceivedFile): Promise<UploadItemResult> {
    const existing = await this.prisma.creativeFile.findFirst({ where: { userId, sha256: file.sha256, deletedAt: null } });
    if (existing) return { originalName: file.originalName, ok: true, duplicate: true, file: this.creatives.toDto(existing) };

    const probe: ProbeResult = file.kind === 'IMAGE' ? await this.probe.probeImage(file.tmpPath) : await this.probe.probeVideo(file.tmpPath);
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
            : await this.probe.videoThumbnail(file.tmpPath, probe.durationMs ?? 0, `${file.tmpPath}.thumb.jpg`);
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
      await this.audit.log({ action: 'creative.uploaded', actorUserId: userId, subjectUserId: userId, targetType: 'creative', targetId: id, metadata: { name: file.originalName, type: file.kind, size: actualSize } });
      return { originalName: file.originalName, ok: true, file: this.creatives.toDto(row), warnings: probe.warnings };
    } catch (err) {
      await this.releaseQuota(userId, actualSize);
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /** Atomically reserves storage (per-user override or the global limit). */
  private async reserveQuota(userId: string, bytes: number): Promise<void> {
    const { maxUserStorageMb } = await this.settings.get('files');
    const globalQuota = BigInt(maxUserStorageMb) * BigInt(MB);
    const size = BigInt(bytes);
    const updated = await this.prisma.$executeRaw`
      UPDATE users SET "storageUsedBytes" = "storageUsedBytes" + ${size}
      WHERE id = ${userId}::uuid AND "storageUsedBytes" + ${size} <= COALESCE("storageQuotaBytes", ${globalQuota})`;
    if (updated !== 1) throw new AppError('QUOTA_EXCEEDED', 'Your storage quota is full. Delete unused creatives or ask the administrator for more space.');
  }

  private async releaseQuota(userId: string, bytes: number): Promise<void> {
    await this.prisma.$executeRaw`UPDATE users SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${BigInt(bytes)}) WHERE id = ${userId}::uuid`;
  }
}
