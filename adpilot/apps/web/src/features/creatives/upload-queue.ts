'use client';

import { META_MEDIA_LIMITS } from '@adpilot/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getErrorMessage, isApiError } from '@/lib/api/errors';
import { formatBytes } from '@/lib/utils/format';
import { creativesApi } from './api';
import type { CreativeDto, CreativeUsage } from './types';

export type UploadStatus = 'queued' | 'waiting' | 'uploading' | 'processing' | 'done' | 'duplicate' | 'error' | 'cancelled';

export interface UploadItem {
  id: string;
  file: File;
  kind: 'IMAGE' | 'VIDEO' | null;
  status: UploadStatus;
  /** 0…1 of the request body. */
  progress: number;
  error?: string;
  /** Shown while a file waits to be retried (e.g. other uploads of the account are still running). */
  note?: string;
  /** Automatic retries after short "too many uploads at once" rejections. */
  autoRetries?: number;
  warnings?: string[];
  result?: CreativeDto;
}

/** The API allows only a few simultaneous uploads per user; short 429s are retried automatically. */
const MAX_AUTO_RETRIES = 5;
const MAX_AUTO_RETRY_WAIT_S = 30;

const MB = 1024 * 1024;
const IMAGE_EXT = new Set<string>(META_MEDIA_LIMITS.image.extensions);
const VIDEO_EXT = new Set<string>(META_MEDIA_LIMITS.video.extensions);

export const ACCEPTED_FILES = [...IMAGE_EXT, ...VIDEO_EXT].map((e) => `.${e}`).join(',');

export function fileKind(name: string): 'IMAGE' | 'VIDEO' | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXT.has(ext) ? 'IMAGE' : VIDEO_EXT.has(ext) ? 'VIDEO' : null;
}

/** Client-side pre-checks mirroring the server (the server re-validates and probes every file). */
export function validateFile(file: File, usage: CreativeUsage | undefined, reservedBytes: number): string | null {
  const kind = fileKind(file.name);
  if (!kind) return `Unsupported file type. Images: ${[...IMAGE_EXT].join(', ').toUpperCase()}; videos: ${[...VIDEO_EXT].join(', ').toUpperCase()}.`;
  if (file.size === 0) return 'The file is empty.';
  if (usage) {
    const limitMb = Math.min(kind === 'IMAGE' ? usage.limits.maxImageSizeMb : usage.limits.maxVideoSizeMb, usage.limits.maxUploadSizeMb);
    if (file.size > limitMb * MB) return `File is larger than the ${limitMb} MB limit for ${kind === 'IMAGE' ? 'images' : 'videos'}.`;
    const free = Number(usage.quotaBytes) - Number(usage.usedBytes) - reservedBytes;
    if (file.size > free) return `Not enough storage left (${formatBytes(Math.max(0, free))} free). Delete unused creatives first.`;
  }
  return null;
}

let counter = 0;

/**
 * Upload queue kept outside React state (subscribed with useSyncExternalStore): files upload with limited
 * concurrency, each with its own XHR progress, result, cancel and retry.
 */
export class UploadQueue {
  private items: UploadItem[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, AbortController>();
  private active = 0;

  constructor(
    private readonly concurrency: number,
    private readonly onSettled: (item: UploadItem) => void,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.items;

  private emit() {
    for (const l of this.listeners) l();
  }

  private patch(id: string, patch: Partial<UploadItem>) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.emit();
  }

  /** Bytes of files that are queued or uploading (reserved against the quota). */
  pendingBytes(): number {
    return this.items.filter((i) => i.status === 'queued' || i.status === 'waiting' || i.status === 'uploading' || i.status === 'processing').reduce((n, i) => n + i.file.size, 0);
  }

  add(files: File[], usage: CreativeUsage | undefined) {
    let reserved = this.pendingBytes();
    const added: UploadItem[] = files.map((file) => {
      const error = validateFile(file, usage, reserved);
      if (!error) reserved += file.size;
      return { id: `upload-${++counter}`, file, kind: fileKind(file.name), status: error ? 'error' : 'queued', progress: 0, error: error ?? undefined };
    });
    this.items = [...added, ...this.items];
    this.emit();
    this.pump();
  }

  private pump() {
    while (this.active < this.concurrency) {
      const next = [...this.items].reverse().find((i) => i.status === 'queued');
      if (!next) return;
      void this.run(next);
    }
  }

  private async run(item: UploadItem) {
    this.active++;
    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    this.patch(item.id, { status: 'uploading', progress: 0, error: undefined, note: undefined, warnings: undefined });
    let lastPercent = -1;
    try {
      const res = await creativesApi.upload(item.file, {
        signal: controller.signal,
        onProgress: (loaded, total) => {
          const percent = total ? Math.floor((loaded / total) * 100) : 0;
          if (percent !== lastPercent) {
            lastPercent = percent;
            this.patch(item.id, { progress: percent / 100 });
          }
        },
        onSent: () => this.patch(item.id, { status: 'processing', progress: 1 }),
      });
      const result = res.results[0];
      if (!result) this.patch(item.id, { status: 'error', error: 'The server did not return a result for this file.' });
      else if (!result.ok) this.patch(item.id, { status: 'error', error: result.error ?? 'The file was rejected.' });
      else this.patch(item.id, { status: result.duplicate ? 'duplicate' : 'done', result: result.file, warnings: result.warnings?.length ? result.warnings : undefined, progress: 1 });
    } catch (error) {
      const retries = this.items.find((i) => i.id === item.id)?.autoRetries ?? 0;
      const wait = isApiError(error, 'RATE_LIMITED') ? (error.retryAfterSeconds ?? 5) : null;
      if (error instanceof DOMException && error.name === 'AbortError') this.patch(item.id, { status: 'cancelled' });
      else if (wait !== null && wait <= MAX_AUTO_RETRY_WAIT_S && retries < MAX_AUTO_RETRIES) {
        // Other uploads of this account (e.g. in another tab) are still running: wait and try again.
        this.patch(item.id, { status: 'waiting', progress: 0, autoRetries: retries + 1, note: 'Waiting for other uploads to finish…' });
        setTimeout(() => {
          if (this.items.find((i) => i.id === item.id)?.status === 'waiting') {
            this.patch(item.id, { status: 'queued' });
            this.pump();
          }
        }, Math.max(1, wait) * 1000);
      } else this.patch(item.id, { status: 'error', error: getErrorMessage(error), note: undefined });
    } finally {
      this.controllers.delete(item.id);
      this.active--;
      const settled = this.items.find((i) => i.id === item.id);
      if (settled) this.onSettled(settled);
      this.pump();
    }
  }

  cancel(id: string) {
    const controller = this.controllers.get(id);
    const status = this.items.find((i) => i.id === id)?.status;
    if (controller) controller.abort();
    else if (status === 'queued' || status === 'waiting') this.patch(id, { status: 'cancelled', note: undefined });
  }

  retry(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (!item || !item.kind) return;
    this.patch(id, { status: 'queued', progress: 0, error: undefined, note: undefined, autoRetries: 0 });
    this.pump();
  }

  dismiss(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
  }

  clearFinished() {
    this.items = this.items.filter((i) => i.status === 'queued' || i.status === 'waiting' || i.status === 'uploading' || i.status === 'processing');
    this.emit();
  }
}

const EMPTY: UploadItem[] = [];
const settledListeners = new Set<(item: UploadItem) => void>();
let sharedQueue: UploadQueue | null = null;

/** One queue per browser tab: uploads keep running (and stay visible) when moving between pages. */
function getQueue(): UploadQueue {
  sharedQueue ??= new UploadQueue(2, (item) => {
    for (const listener of settledListeners) listener(item);
  });
  return sharedQueue;
}

export function useUploadQueue(onSettled?: (item: UploadItem) => void) {
  const [queue] = useState(getQueue);
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY);
  useEffect(() => {
    if (!onSettled) return;
    settledListeners.add(onSettled);
    return () => {
      settledListeners.delete(onSettled);
    };
  }, [onSettled]);
  return { queue, items };
}
