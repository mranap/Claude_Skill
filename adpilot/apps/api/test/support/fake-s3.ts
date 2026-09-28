/**
 * TEST DOUBLE — a minimal S3-compatible object store (path-style) used by automated tests and optional local
 * development when MinIO is not available. Supports: bucket HEAD/PUT, object PUT/GET (Range)/HEAD/DELETE and
 * multipart uploads (as used by @aws-sdk/lib-storage). Not for production use.
 */
import http, { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';

interface StoredObject {
  body: Buffer;
  contentType: string;
  etag: string;
}

export class FakeS3 {
  private server!: http.Server;
  port = 0;
  readonly buckets = new Map<string, Map<string, StoredObject>>();
  private readonly uploads = new Map<string, { bucket: string; key: string; parts: Map<number, Buffer>; contentType: string }>();

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(port = 0): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private read(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  private xml(res: ServerResponse, status: number, body: string) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/xml');
    res.end(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
  }

  private notFound(res: ServerResponse, code = 'NoSuchKey') {
    this.xml(res, 404, `<Error><Code>${code}</Code><Message>Not found</Message></Error>`);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [bucket, ...rest] = url.pathname.replace(/^\//, '').split('/');
    const key = decodeURIComponent(rest.join('/'));
    const method = req.method ?? 'GET';
    if (!bucket) return this.xml(res, 200, '<ListAllMyBucketsResult/>');

    if (!key) {
      if (method === 'PUT') {
        if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map());
        res.statusCode = 200;
        return void res.end();
      }
      if (method === 'HEAD') {
        res.statusCode = this.buckets.has(bucket) ? 200 : 404;
        return void res.end();
      }
      return this.xml(res, 200, '<ListBucketResult/>');
    }

    const store = this.buckets.get(bucket);
    if (!store) return this.notFound(res, 'NoSuchBucket');

    // Multipart uploads
    if (method === 'POST' && url.searchParams.has('uploads')) {
      const uploadId = randomUUID();
      this.uploads.set(uploadId, { bucket, key, parts: new Map(), contentType: String(req.headers['content-type'] ?? 'application/octet-stream') });
      return this.xml(res, 200, `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`);
    }
    const uploadId = url.searchParams.get('uploadId');
    if (uploadId) {
      const up = this.uploads.get(uploadId);
      if (!up) return this.notFound(res, 'NoSuchUpload');
      if (method === 'PUT') {
        const body = await this.read(req);
        up.parts.set(Number(url.searchParams.get('partNumber')), body);
        res.setHeader('ETag', `"${createHash('md5').update(body).digest('hex')}"`);
        res.statusCode = 200;
        return void res.end();
      }
      if (method === 'POST') {
        await this.read(req);
        const body = Buffer.concat([...up.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b));
        const etag = `"${createHash('md5').update(body).digest('hex')}-${up.parts.size}"`;
        store.set(key, { body, contentType: up.contentType, etag });
        this.uploads.delete(uploadId);
        return this.xml(res, 200, `<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><ETag>${etag}</ETag></CompleteMultipartUploadResult>`);
      }
      if (method === 'DELETE') {
        this.uploads.delete(uploadId);
        res.statusCode = 204;
        return void res.end();
      }
    }

    if (method === 'PUT') {
      const body = await this.read(req);
      const etag = `"${createHash('md5').update(body).digest('hex')}"`;
      store.set(key, { body, contentType: String(req.headers['content-type'] ?? 'application/octet-stream'), etag });
      res.setHeader('ETag', etag);
      res.statusCode = 200;
      return void res.end();
    }
    const obj = store.get(key);
    if (method === 'DELETE') {
      store.delete(key);
      res.statusCode = 204;
      return void res.end();
    }
    if (!obj) return this.notFound(res);
    res.setHeader('ETag', obj.etag);
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (method === 'HEAD') {
      res.setHeader('Content-Length', String(obj.body.length));
      res.statusCode = 200;
      return void res.end();
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, obj.body.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), obj.body.length - 1) : obj.body.length - 1;
      const slice = obj.body.subarray(start, end + 1);
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${obj.body.length}`);
      res.setHeader('Content-Length', String(slice.length));
      return void res.end(slice);
    }
    res.statusCode = 200;
    res.setHeader('Content-Length', String(obj.body.length));
    res.end(obj.body);
  }
}

// Allow `node --experimental-strip-types test/support/fake-s3.ts [port]` for local development.
if (process.argv[1]?.endsWith('fake-s3.ts')) {
  const s3 = new FakeS3();
  void s3.start(Number(process.argv[2] ?? 9000)).then(() => {
    for (const b of (process.env.FAKE_S3_BUCKETS ?? 'adpilot-media,adpilot-backups').split(',')) s3.buckets.set(b, new Map());
    console.log(`Fake S3 listening on ${s3.endpoint}`);
  });
}
