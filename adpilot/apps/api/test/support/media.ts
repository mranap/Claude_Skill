import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiClient } from './http-client';
import { expectStatus } from './http-client';

/**
 * Generates real media files with ffmpeg (the same binary the platform uses for probing) so uploads go
 * through the production validation and thumbnail pipeline.
 */
export function generateMedia(dir: string) {
  mkdirSync(dir, { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const run = (args: string[]) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  const video = (name: string, color: string, seconds: number, size = '720x1280') => {
    const out = join(dir, name);
    run(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25,drawbox=color=${color}@0.5:t=fill`, '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
    return out;
  };
  const image = (name: string, color: string, size = '1080x1080') => {
    const out = join(dir, name);
    run(['-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', out]);
    return out;
  };
  return {
    videoA: video('video_a.mp4', 'red', 2),
    videoB: video('video_b.mp4', 'blue', 3),
    imageA: image('image_a.jpg', 'green'),
    imageB: image('image_b.jpg', 'yellow'),
    tinyImage: image('tiny.jpg', 'white', '200x200'),
  };
}

export async function uploadCreative(client: ApiClient, path: string, mime: string): Promise<{ id: string; status: string; type: string }> {
  const form = new FormData();
  form.append('files', new Blob([readFileSync(path)], { type: mime }), path.split('/').pop());
  const res = expectStatus(await client.request('POST', '/api/creatives/upload', undefined, { form }), 200).body as {
    results: { ok: boolean; error?: string; file?: { id: string; status: string; type: string } }[];
  };
  const r = res.results[0]!;
  if (!r.ok || !r.file) throw new Error(`Upload failed: ${r.error}`);
  return r.file;
}
