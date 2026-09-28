import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { META_MEDIA_LIMITS, describeAspectRatio } from '@adpilot/shared';
import { AppConfig } from '../../config/app-config';

const execFileAsync = promisify(execFile);

export type DetectedFormat = 'jpeg' | 'png' | 'mp4' | 'mov' | 'unknown';

export interface ProbeResult {
  format: DetectedFormat;
  mimeType: string;
  width: number;
  height: number;
  durationMs?: number;
  videoCodec?: string;
  audioCodec?: string;
  frameRate?: number;
  bitrate?: number;
  aspectRatio: string;
  warnings: string[];
}

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaValidationError';
  }
}

/**
 * Server-side media validation. The browser checks are only a convenience; here the real content is
 * inspected: magic bytes, decoder metadata (sharp for images, ffprobe for videos) and Meta's limits.
 */
@Injectable()
export class MediaProbeService {
  constructor(private readonly config: AppConfig) {}

  /** Detects the container from the first bytes (never trusts the extension or Content-Type). */
  async sniff(path: string): Promise<DetectedFormat> {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(32);
      await fh.read(buf, 0, 32, 0);
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
      if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
      if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = buf.subarray(8, 12).toString('ascii');
        return brand === 'qt  ' ? 'mov' : 'mp4';
      }
      // QuickTime files may start with other atoms (wide/mdat/moov) before ftyp.
      if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(buf.subarray(4, 8).toString('ascii'))) return 'mov';
      return 'unknown';
    } finally {
      await fh.close();
    }
  }

  async probeImage(path: string): Promise<ProbeResult> {
    const format = await this.sniff(path);
    if (format !== 'jpeg' && format !== 'png') throw new MediaValidationError('The file is not a valid JPG or PNG image.');
    let meta: sharp.Metadata;
    try {
      meta = await sharp(path, { failOn: 'error' }).metadata();
    } catch {
      throw new MediaValidationError('The image is corrupted or cannot be decoded.');
    }
    const width = meta.autoOrient?.width ?? meta.width ?? 0;
    const height = meta.autoOrient?.height ?? meta.height ?? 0;
    const warnings: string[] = [];
    const { minWidth, minHeight } = META_MEDIA_LIMITS.image;
    if (width < minWidth || height < minHeight) {
      warnings.push(`Low resolution (${width}×${height}). Meta recommends at least 1080 px; some placements need ≥ ${minWidth} px.`);
    }
    return {
      format,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      width,
      height,
      aspectRatio: describeAspectRatio(width, height),
      warnings,
    };
  }

  async probeVideo(path: string): Promise<ProbeResult> {
    const format = await this.sniff(path);
    if (format !== 'mp4' && format !== 'mov') throw new MediaValidationError('The file is not a valid MP4 or MOV video.');
    let json: {
      format?: { duration?: string; bit_rate?: string; format_name?: string };
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
    };
    try {
      const { stdout } = await execFileAsync(
        this.config.env.FFPROBE_PATH,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      );
      json = JSON.parse(stdout);
    } catch {
      throw new MediaValidationError('The video is corrupted or cannot be read.');
    }
    const video = json.streams?.find((s) => s.codec_type === 'video');
    const audio = json.streams?.find((s) => s.codec_type === 'audio');
    if (!video?.width || !video.height) throw new MediaValidationError('The file does not contain a video stream.');
    const rotation = Math.abs(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0));
    const [width, height] = rotation === 90 || rotation === 270 ? [video.height, video.width] : [video.width, video.height];
    const durationSec = Number(json.format?.duration ?? 0);
    const limits = META_MEDIA_LIMITS.video;
    if (!Number.isFinite(durationSec) || durationSec < limits.minDurationSec) throw new MediaValidationError(`The video must be at least ${limits.minDurationSec} s long.`);
    if (durationSec > limits.maxDurationSec) throw new MediaValidationError(`The video is longer than Meta's limit (${limits.maxDurationSec / 60} minutes).`);
    if (width < limits.minWidth || height < limits.minHeight) throw new MediaValidationError(`The video resolution ${width}×${height} is too small.`);

    const warnings: string[] = [];
    const codec = video.codec_name ?? 'unknown';
    if (!(limits.recommendedCodecs as readonly string[]).includes(codec)) {
      warnings.push(`Video codec "${codec}" is unusual; Meta recommends H.264. Meta may fail to process it.`);
    }
    if (!audio) warnings.push('The video has no audio track.');
    if (Math.min(width, height) < 540) warnings.push(`Low resolution (${width}×${height}); Meta recommends at least 1080 px.`);
    const [num, den] = (video.avg_frame_rate ?? '0/1').split('/').map(Number);
    const frameRate = den ? Math.round(((num ?? 0) / den) * 1000) / 1000 : undefined;
    return {
      format,
      mimeType: format === 'mov' ? 'video/quicktime' : 'video/mp4',
      width,
      height,
      durationMs: Math.round(durationSec * 1000),
      videoCodec: codec,
      audioCodec: audio?.codec_name,
      frameRate: frameRate && Number.isFinite(frameRate) ? frameRate : undefined,
      bitrate: json.format?.bit_rate ? Number(json.format.bit_rate) : undefined,
      aspectRatio: describeAspectRatio(width, height),
      warnings,
    };
  }

  /** 480 px JPEG preview for the library (images). */
  async imageThumbnail(path: string): Promise<Buffer> {
    return sharp(path).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  }

  /** Extracts a poster frame from a video (at 1 s or 10 % of the duration). */
  async videoThumbnail(path: string, durationMs: number, outPath: string): Promise<Buffer> {
    const at = Math.min(1, (durationMs / 1000) * 0.1).toFixed(2);
    await execFileAsync(
      this.config.env.FFMPEG_PATH,
      ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', path, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', outPath],
      { timeout: 60_000 },
    );
    return sharp(outPath).jpeg({ quality: 78 }).toBuffer();
  }
}
