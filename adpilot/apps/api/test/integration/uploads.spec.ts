import { mkdtempSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestStack, type TestUser } from '../support/harness';
import { ApiClient, expectStatus } from '../support/http-client';
import { generateMedia, uploadCreative } from '../support/media';

const BOUNDARY = '----adpilot-upload-test';
const partHead = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="big.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;

describe('creative uploads: interrupted transfers and storage quota', () => {
  const stack = new TestStack();
  let admin: ApiClient;
  let user: TestUser;
  let media: ReturnType<typeof generateMedia>;
  const uploadDir = () => join(process.env.TMP_DIR!, 'uploads');
  const tmpFiles = async () => (await readdir(uploadDir()).catch(() => [] as string[])).length;

  beforeAll(async () => {
    await stack.start();
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    media = generateMedia(mkdtempSync(join(tmpdir(), 'adpilot-media-')));
  });
  afterAll(() => stack.stop());

  /** Starts a multipart upload, streams `bytes` of a file and returns controls for the open request. */
  const openUpload = (client: ApiClient, opts: { declaredBytes?: number } = {}) => {
    const url = new URL('/api/creatives/upload', client.baseUrl);
    let response: Promise<{ status: number; body: string }> = Promise.resolve({ status: 0, body: '' });
    const req = httpRequest(url, {
      method: 'POST',
      headers: {
        ...client.rawHeaders(url.pathname),
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        ...(opts.declaredBytes
          ? { 'Content-Length': String(partHead.length + opts.declaredBytes + BOUNDARY.length + 8) }
          : {}),
      },
    });
    response = new Promise((resolve) => {
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
    });
    req.write(partHead);
    return {
      send: (bytes: number) => new Promise<void>((r) => req.write(Buffer.alloc(bytes, 7), () => r())),
      finish: () => req.end(`\r\n--${BOUNDARY}--\r\n`),
      abort: () => req.destroy(),
      response,
    };
  };

  it('removes the partial file of an aborted upload and frees the upload slot', async () => {
    for (let i = 0; i < 4; i++) {
      const upload = openUpload(user.client, { declaredBytes: 50 * 1024 * 1024 });
      await upload.send(2 * 1024 * 1024);
      await stack.waitFor(async () => (await tmpFiles()) === 1); // really streaming to disk
      upload.abort();
      await stack.waitFor(async () => (await tmpFiles()) === 0);
    }
    // Four aborted uploads in a row: the per-user concurrency slots were all released.
    const file = await uploadCreative(user.client, media.imageA, 'image/jpeg');
    expect(file.status).toBe('READY');
  });

  it('answers 404 (not 500) when the stored file of a creative is missing', async () => {
    const file = await uploadCreative(user.client, media.imageB, 'image/jpeg');
    const row = await stack.prisma.creativeFile.findUniqueOrThrow({ where: { id: file.id } });
    stack.s3.buckets.get(process.env.S3_BUCKET!)!.delete(row.storageKey);
    expect((await user.client.get(`/api/creatives/${file.id}/file`)).status).toBe(404);
  });

  it('refuses uploads beyond the remaining storage quota before and while streaming', async () => {
    expectStatus(await admin.patch(`/api/admin/users/${user.id}`, { storageQuotaMb: 1 }), 200);
    // Declared size larger than the remaining quota: refused before anything is written.
    const declared = openUpload(user.client, { declaredBytes: 5 * 1024 * 1024 });
    const early = await declared.response;
    expect(early.status).toBe(422);
    expect(JSON.parse(early.body).error.code).toBe('QUOTA_EXCEEDED');

    // No Content-Length (chunked): the file is cut off as soon as it exceeds the remaining quota.
    const chunked = openUpload(user.client);
    for (let i = 0; i < 3; i++) await chunked.send(1024 * 1024);
    chunked.finish();
    const res = await chunked.response;
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).results[0]).toMatchObject({
      ok: false,
      error: 'This file does not fit into your remaining storage.',
    });
    expect(await tmpFiles()).toBe(0);
  });
});
