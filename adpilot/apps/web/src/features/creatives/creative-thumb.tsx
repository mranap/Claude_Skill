'use client';

import { Film, ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format';
import type { CreativeDto } from './types';

export function formatDuration(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "1080×1920 · 9:16 · 12.3 MB" */
export function describeCreative(
  c: Pick<CreativeDto, 'width' | 'height' | 'aspectRatio' | 'sizeBytes'>,
): string {
  return [c.width && c.height ? `${c.width}×${c.height}` : null, c.aspectRatio, formatBytes(c.sizeBytes)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Thumbnail from the authenticated same-origin API. A plain <img> is used on purpose: the image optimizer
 * cannot forward the session cookie.
 */
export function CreativeThumb({
  creative,
  className,
  fit = 'cover',
  showBadge = true,
}: {
  creative: Pick<CreativeDto, 'type' | 'previewUrl' | 'name' | 'durationMs'>;
  className?: string;
  fit?: 'cover' | 'contain';
  showBadge?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = creative.type === 'VIDEO' ? Film : ImageIcon;
  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden bg-muted', className)}>
      {creative.previewUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated API media, see comment above
        <img
          src={creative.previewUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn('size-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
        />
      ) : (
        <Icon className="size-6 text-muted-foreground" aria-hidden />
      )}
      {showBadge && creative.type === 'VIDEO' ? (
        <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
          <Film className="size-3" aria-hidden />
          {formatDuration(creative.durationMs)}
        </span>
      ) : null}
    </div>
  );
}
