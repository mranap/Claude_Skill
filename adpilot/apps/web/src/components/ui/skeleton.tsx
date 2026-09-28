import type * as React from 'react';
import { cn } from '@/lib/utils/cn';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted dark:bg-white/[0.06]', className)}
      {...props}
    />
  );
}
