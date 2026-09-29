import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

export function hasFfmpeg(): boolean {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface TestMedia {
  /** 1080×1080 JPEG. */
  image: string;
  /** 720×1280 H.264/AAC MP4, 3 seconds. */
  video: string;
  /** Removes the temporary directory. */
  cleanup: () => void;
}

/**
 * Generates an image and a video in a new temporary directory. A random colour (and the stamp in the video
 * metadata) makes every run's files unique, so the library's duplicate detection (SHA-256) never matches an
 * earlier upload and the files can be found by name.
 */
export function generateMedia(stamp: string): TestMedia {
  const dir = mkdtempSync(path.join(tmpdir(), 'adpilot-e2e-'));
  const colour = `0x${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;
  const image = path.join(dir, `e2e-square-${stamp}.jpg`);
  const video = path.join(dir, `e2e-story-${stamp}.mp4`);
  const ffmpeg = (args: string[]) =>
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
  try {
    ffmpeg(['-f', 'lavfi', '-i', `color=c=${colour}:s=1080x1080`, '-frames:v', '1', '-q:v', '3', image]);
    // Meta's video pipeline expects H.264 + AAC; faststart puts the index first like typical exports.
    ffmpeg([
      ...['-f', 'lavfi', '-i', `color=c=${colour}:s=720x1280:r=25:d=3`],
      ...['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'],
      ...['-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k'],
      ...['-metadata', `comment=adpilot-e2e-${stamp}`, '-movflags', '+faststart', video],
    ]);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { image, video, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
