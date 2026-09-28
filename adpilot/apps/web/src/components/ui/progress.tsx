'use client';

import { Progress as ProgressPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';

const TONES = {
  default: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
} as const;

export function Progress({
  className,
  value,
  tone = 'default',
  indeterminate = false,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  tone?: keyof typeof TONES;
  indeterminate?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={indeterminate ? null : pct}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-muted dark:bg-white/[0.08]',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          TONES[tone],
          indeterminate && 'w-2/5 animate-indeterminate',
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
