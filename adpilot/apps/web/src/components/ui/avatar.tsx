'use client';

import { Avatar as AvatarPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { initials } from '@/lib/utils/strings';

const TONES = [
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
];

function toneFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return TONES[Math.abs(hash) % TONES.length]!;
}

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-7 text-[11px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg',
} as const;

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

export const AvatarImage = AvatarPrimitive.Image;
export const AvatarFallback = AvatarPrimitive.Fallback;

/** Initials avatar with a stable colour derived from the user's id/e-mail. */
export function UserAvatar({
  name,
  email,
  seed,
  size = 'md',
  className,
}: {
  name?: string | null;
  email?: string | null;
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const key = seed ?? email ?? name ?? '?';
  return (
    <Avatar className={cn(SIZES[size], className)}>
      <AvatarFallback
        className={cn('flex size-full items-center justify-center rounded-full font-semibold select-none', toneFor(key))}
      >
        {initials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
