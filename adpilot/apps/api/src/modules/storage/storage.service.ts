import { Injectable } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { AppConfig } from '../../config/app-config';

/**
 * S3-compatible object storage (MinIO in docker-compose, AWS S3 / R2 / Wasabi in production).
 * The bucket is private: files are streamed to the browser through the API after an ownership check.
 */
@Injectable()
export class StorageService {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(private readonly config: AppConfig) {
    const env = config.env;
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async uploadFile(key: string, filePath: string, contentType: string, bucket = this.bucket): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: bucket, Key: key, Body: createReadStream(filePath), ContentType: contentType },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
    });
    await upload.done();
  }

  async uploadBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    const upload = new Upload({ client: this.client, params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType } });
    await upload.done();
  }

  async getStream(key: string, range?: string): Promise<{ body: Readable; contentLength?: number; contentRange?: string; contentType?: string }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }));
    return {
      body: res.Body as Readable,
      contentLength: res.ContentLength,
      contentRange: res.ContentRange,
      contentType: res.ContentType,
    };
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async delete(key: string, bucket = this.bucket): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, detail: `Bucket "${this.bucket}" reachable` };
    } catch (err) {
      return { ok: false, detail: (err as Error).name + ': ' + (err as Error).message };
    }
  }

  /** Creates the bucket if it does not exist (used at startup for MinIO deployments). */
  async ensureBucket(bucket = this.bucket): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
    }
  }
}
