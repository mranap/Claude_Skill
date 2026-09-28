'use client';

import { ToggleGroup } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

/** Single-choice pill group. Never allows an empty value (clicking the active item keeps it). */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = 'default',
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cn(
        'inline-flex w-fit items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5 dark:bg-muted/40',
        disabled && 'opacity-60',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          title={option.title}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap text-muted-foreground outline-none transition-[color,background-color,box-shadow]',
            'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            'data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:data-[state=on]:bg-accent',
            'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-[13px]',
          )}
        >
          {option.icon}
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
