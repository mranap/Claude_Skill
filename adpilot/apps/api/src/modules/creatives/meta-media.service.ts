import { Injectable } from '@nestjs/common';
import FormData from 'form-data';
import { mkdir, open, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MetaConnection, MetaGraphClient } from '../meta/graph/meta-graph.client';
import { MetaApiError } from '../meta/graph/meta-errors';
import { actId } from '../meta/meta-fields';
import type { CreativeFile, CreativeMetaAsset } from '../../generated/prisma/client';

export type MediaStepResult =
  | { state: 'READY' }
  | { state: 'PROCESSING'; recheckInMs: number }
  | { state: 'FAILED'; error: string };

interface VideoStatus {
  video_status?: string;
  processing_progress?: number;
  uploading_phase?: { status?: string };
  processing_phase?: { status?: string; errors?: { code?: number; message?: string }[] };
  publishing_phase?: { status?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads library files to a specific ad account:
 *  - images → POST /act_{id}/adimages (multipart) → the image `hash` used by ad creatives;
 *  - videos → resumable upload to graph-video.facebook.com (start / transfer chunks / finish), then Meta
 *    processes the video asynchronously: the asset stays PROCESSING until `status.video_status` is "ready".
 * The video id is stored right after the "start" phase, so a worker restart never uploads the same file
 * twice; ad creation waits for READY.
 */
@Injectable()
export class MetaMediaService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly graph: MetaGraphClient,
  ) {}

  async process(conn: MetaConnection, asset: CreativeMetaAsset, file: CreativeFile, metaAccountId: string): Promise<MediaStepResult> {
    if (asset.status === 'READY') return { state: 'READY' };
    if (file.type === 'IMAGE') return this.uploadImage(conn, asset, file, metaAccountId);
    if (asset.metaVideoId) {
      const checked = await this.checkVideo(conn, asset);
      if (checked.state !== 'INCOMPLETE') return checked;
      // The previous upload never completed (worker stopped mid-transfer): start a fresh upload.
      await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { metaVideoId: null, uploadSessionId: null } });
    }
    return this.uploadVideo(conn, asset, file, metaAccountId);
  }

  private async download(file: CreativeFile): Promise<string> {
    const dir = join(this.config.env.TMP_DIR, 'meta-upload');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${file.id}-${Date.now()}.${file.extension}`);
    const { body } = await this.storage.getStream(file.storageKey);
    await pipeline(body, createWriteStream(path));
    return path;
  }

  private async uploadImage(conn: MetaConnection, asset: CreativeMetaAsset, file: CreativeFile, metaAccountId: string): Promise<MediaStepResult> {
    await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { status: 'UPLOADING', attempts: { increment: 1 } } });
    const path = await this.download(file);
    try {
      const fh = await open(path, 'r');
      const buffer = await fh.readFile();
      await fh.close();
      const fieldName = `adpilot_${file.id}.${file.extension}`;
      const form = new FormData();
      form.append(fieldName, buffer, { filename: fieldName, contentType: file.mimeType });
      const res = await this.graph.call<{ images?: Record<string, { hash: string; url?: string }> }>(conn, {
        method: 'POST',
        path: `/${actId(metaAccountId)}/adimages`,
        multipart: form,
        category: 'media.image_upload',
        metaAccountId,
        timeoutMs: 5 * 60_000,
      });
      const images = res.data.images ?? {};
      const entry = images[fieldName] ?? Object.values(images)[0];
      if (!entry?.hash) throw new Error('Meta did not return an image hash');
      await this.prisma.creativeMetaAsset.update({
        where: { id: asset.id },
        data: { status: 'READY', metaImageHash: entry.hash, metaImageUrl: entry.url ?? null, error: null, errorCode: null, readyAt: new Date() },
      });
      return { state: 'READY' };
    } finally {
      await rm(path, { force: true });
    }
  }

  private async uploadVideo(conn: MetaConnection, asset: CreativeMetaAsset, file: CreativeFile, metaAccountId: string): Promise<MediaStepResult> {
    await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { status: 'UPLOADING', attempts: { increment: 1 } } });
    const path = await this.download(file);
    const act = actId(metaAccountId);
    try {
      const size = Number(file.sizeBytes);
      const start = await this.graph.call<{ upload_session_id: string; video_id: string; start_offset: string; end_offset: string }>(conn, {
        method: 'POST',
        host: 'video',
        path: `/${act}/advideos`,
        params: { upload_phase: 'start', file_size: size },
        category: 'media.video_upload_start',
        metaAccountId,
      });
      const sessionId = start.data.upload_session_id;
      // Persist the video id immediately: from now on retries only poll this video, never re-upload.
      await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { metaVideoId: start.data.video_id, uploadSessionId: sessionId } });

      let startOffset = Number(start.data.start_offset);
      let endOffset = Number(start.data.end_offset);
      const fh = await open(path, 'r');
      let transientRetries = 0;
      try {
        while (startOffset < endOffset) {
          const length = endOffset - startOffset;
          const chunk = Buffer.alloc(length);
          await fh.read(chunk, 0, length, startOffset);
          const form = new FormData();
          form.append('video_file_chunk', chunk, { filename: `chunk-${startOffset}`, contentType: 'application/octet-stream' });
          try {
            const res = await this.graph.call<{ start_offset: string; end_offset: string }>(conn, {
              method: 'POST',
              host: 'video',
              path: `/${act}/advideos`,
              params: { upload_phase: 'transfer', upload_session_id: sessionId, start_offset: startOffset },
              multipart: form,
              category: 'media.video_upload_transfer',
              metaAccountId,
              timeoutMs: 10 * 60_000,
              skipConcurrencySlot: true,
            });
            startOffset = Number(res.data.start_offset);
            endOffset = Number(res.data.end_offset);
            transientRetries = 0;
          } catch (err) {
            // Subcode 1363037: Meta expects a different offset — resume from the offsets it returns.
            const data = (err instanceof MetaApiError ? (err.raw?.error_data as { start_offset?: string; end_offset?: string } | undefined) : undefined) ?? {};
            if (err instanceof MetaApiError && err.metaSubcode === 1363037 && data.start_offset !== undefined && transientRetries < 5) {
              startOffset = Number(data.start_offset);
              endOffset = Number(data.end_offset);
              transientRetries++;
              continue;
            }
            if (err instanceof MetaApiError && (err.category === 'TRANSIENT' || err.category === 'NETWORK') && transientRetries < 5) {
              transientRetries++;
              await sleep(1000 * transientRetries);
              continue;
            }
            throw err;
          }
        }
      } finally {
        await fh.close();
      }
      await this.graph.call(conn, {
        method: 'POST',
        host: 'video',
        path: `/${act}/advideos`,
        params: { upload_phase: 'finish', upload_session_id: sessionId, title: file.originalName.slice(0, 250) },
        category: 'media.video_upload_finish',
        metaAccountId,
      });
      await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { status: 'PROCESSING' } });
      return { state: 'PROCESSING', recheckInMs: 15_000 };
    } catch (err) {
      // The video id (if "start" succeeded) is kept: the next attempt first checks that video and only
      // uploads again when Meta reports the previous upload as incomplete — no duplicate uploads.
      await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { status: 'PENDING', error: err instanceof MetaApiError ? err.details.friendlyMessage : String(err) } });
      throw err;
    } finally {
      await rm(path, { force: true });
    }
  }

  /** Polls Meta's asynchronous processing. */
  async checkVideo(conn: MetaConnection, asset: CreativeMetaAsset): Promise<MediaStepResult | { state: 'INCOMPLETE' }> {
    if (!asset.metaVideoId) return { state: 'INCOMPLETE' };
    let status: VideoStatus | undefined;
    try {
      const res = await this.graph.get<{ status?: VideoStatus }>(conn, `/${asset.metaVideoId}`, { fields: 'status' }, 'media.video_status');
      status = res.status;
    } catch (err) {
      if (err instanceof MetaApiError && (err.category === 'NOT_FOUND' || err.category === 'VALIDATION')) return { state: 'INCOMPLETE' };
      throw err;
    }
    await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { lastCheckedAt: new Date() } });
    const vs = status?.video_status;
    const uploading = status?.uploading_phase?.status;
    if (vs !== 'ready' && vs !== 'error' && asset.status !== 'PROCESSING' && uploading && uploading !== 'complete') {
      return { state: 'INCOMPLETE' };
    }
    if (vs === 'ready') {
      const thumb = await this.preferredThumbnail(conn, asset.metaVideoId);
      await this.prisma.creativeMetaAsset.update({
        where: { id: asset.id },
        data: { status: 'READY', thumbnailUrl: thumb, readyAt: new Date(), error: null },
      });
      return { state: 'READY' };
    }
    if (vs === 'error') {
      const reason = status?.processing_phase?.errors?.map((e) => e.message).filter(Boolean).join('; ') || 'Meta could not process this video.';
      await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { status: 'FAILED', error: reason } });
      return { state: 'FAILED', error: reason };
    }
    await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { status: 'PROCESSING' } });
    const progress = status?.processing_progress ?? 0;
    return { state: 'PROCESSING', recheckInMs: progress > 70 ? 10_000 : 20_000 };
  }

  /** Thumbnail URL for video ad creatives (video_data.image_url). */
  async preferredThumbnail(conn: MetaConnection, videoId: string): Promise<string | null> {
    try {
      const res = await this.graph.get<{ data: { uri: string; is_preferred?: boolean }[] }>(conn, `/${videoId}/thumbnails`, {}, 'media.video_thumbnails');
      const list = res.data ?? [];
      return (list.find((t) => t.is_preferred) ?? list[0])?.uri ?? null;
    } catch {
      return null;
    }
  }
}
