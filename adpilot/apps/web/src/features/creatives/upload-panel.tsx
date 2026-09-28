'use client';

import { CircleAlert, CircleCheck, Copy, Film, ImageIcon, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format';
import { ACCEPTED_FILES, type UploadItem, type UploadQueue } from './upload-queue';
import type { CreativeUsage } from './types';

/** Drag & drop area + file picker. */
export function UploadDropzone({
  onFiles,
  usage,
  compact = false,
  className,
}: {
  onFiles: (files: File[]) => void;
  usage?: CreativeUsage;
  compact?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const limits = usage?.limits;
  const imageMb = limits ? Math.min(limits.maxImageSizeMb, limits.maxUploadSizeMb) : 30;
  const videoMb = limits ? Math.min(limits.maxVideoSizeMb, limits.maxUploadSizeMb) : 1024;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card text-center transition-colors',
        compact ? 'px-4 py-5' : 'px-6 py-10',
        dragging && 'border-primary bg-primary/[0.04]',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary-fg">
        <Upload className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium">
        Drag images and videos here or{' '}
        <button type="button" className="text-primary-fg underline-offset-2 hover:underline" onClick={() => input.current?.click()}>
          browse
        </button>
      </p>
      <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
        Images: JPG or PNG up to {formatBytes(imageMb * 1024 * 1024)}, at least 600×600 px. Videos: MP4 or MOV up to {formatBytes(videoMb * 1024 * 1024)}.
        Files are checked like Meta does before they are stored.
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose files to upload"
        data-testid="creative-file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  queued: 'Waiting…',
  waiting: 'Waiting for other uploads…',
  uploading: 'Uploading',
  processing: 'Checking the file…',
  done: 'Uploaded',
  duplicate: 'Already in your library',
  error: 'Failed',
  cancelled: 'Cancelled',
};

/** Per-file upload progress with cancel / retry / dismiss. */
export function UploadList({ items, queue, className }: { items: UploadItem[]; queue: UploadQueue; className?: string }) {
  if (!items.length) return null;
  const running = items.filter((i) => i.status === 'queued' || i.status === 'waiting' || i.status === 'uploading' || i.status === 'processing').length;
  const finished = items.length - running;
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)} aria-label="Uploads" role="region">
      <div className="flex items-center justify-between gap-2 border-b bg-surface-subtle px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">
          {running ? `Uploading ${running} of ${items.length}` : `${items.length} ${items.length === 1 ? 'upload' : 'uploads'} finished`}
        </p>
        {finished ? (
          <Button variant="ghost" size="xs" onClick={() => queue.clearFinished()}>
            Clear finished
          </Button>
        ) : null}
      </div>
      <ul className="max-h-80 divide-y overflow-y-auto">
        {items.map((item) => (
          <UploadRow key={item.id} item={item} queue={queue} />
        ))}
      </ul>
    </div>
  );
}

function UploadRow({ item, queue }: { item: UploadItem; queue: UploadQueue }) {
  const Icon = item.kind === 'VIDEO' ? Film : ImageIcon;
  const active = item.status === 'uploading' || item.status === 'processing' || item.status === 'queued' || item.status === 'waiting';
  const tone =
    item.status === 'error'
      ? 'text-destructive-fg'
      : item.status === 'done'
        ? 'text-success-fg'
        : item.status === 'duplicate'
          ? 'text-info-fg'
          : 'text-muted-foreground';
  return (
    <li className="grid gap-1.5 px-3 py-2.5" data-testid="upload-row" data-status={item.status}>
      <div className="flex items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-sm font-medium">{item.file.name}</p>
          <p className={cn('flex items-center gap-1.5 text-xs', tone)}>
            {item.status === 'uploading' || item.status === 'processing' ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
            {item.status === 'done' ? <CircleCheck className="size-3" aria-hidden /> : null}
            {item.status === 'duplicate' ? <Copy className="size-3" aria-hidden /> : null}
            {item.status === 'error' ? <CircleAlert className="size-3" aria-hidden /> : null}
            <span className="truncate">
              {STATUS_TEXT[item.status]}
              {item.status === 'uploading' ? ` ${Math.round(item.progress * 100)}%` : ''} · {formatBytes(item.file.size)}
            </span>
          </p>
        </div>
        {active ? (
          <Button variant="ghost" size="icon-xs" onClick={() => queue.cancel(item.id)} aria-label={`Cancel ${item.file.name}`}>
            <X />
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            {(item.status === 'error' || item.status === 'cancelled') && item.kind ? (
              <Button variant="ghost" size="icon-xs" onClick={() => queue.retry(item.id)} aria-label={`Retry ${item.file.name}`}>
                <RotateCcw />
              </Button>
            ) : null}
            <Button variant="ghost" size="icon-xs" onClick={() => queue.dismiss(item.id)} aria-label={`Dismiss ${item.file.name}`}>
              <X />
            </Button>
          </div>
        )}
      </div>
      {item.status === 'uploading' || item.status === 'processing' ? (
        <Progress value={item.progress * 100} indeterminate={item.status === 'processing'} className="h-1" aria-label={`Upload progress of ${item.file.name}`} />
      ) : null}
      {item.error ? <p className="text-xs leading-relaxed text-destructive-fg" role="alert">{item.error}</p> : null}
      {item.note && item.status === 'waiting' ? <p className="text-xs leading-relaxed text-muted-foreground">{item.note}</p> : null}
      {item.warnings?.map((w) => (
        <p key={w} className="text-xs leading-relaxed text-warning-fg">
          {w}
        </p>
      ))}
    </li>
  );
}
