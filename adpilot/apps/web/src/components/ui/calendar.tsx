'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type * as React from 'react';
import { DayPicker, type DayButtonProps } from 'react-day-picker';
import { cn } from '@/lib/utils/cn';
import { buttonVariants } from './button';

function CalendarDayButton({ className, day, modifiers, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  const inRange = modifiers.range_start || modifiers.range_end || modifiers.range_middle;
  const edge = modifiers.range_start || modifiers.range_end || (modifiers.selected && !inRange);

  return (
    <button
      ref={ref}
      data-day={day.isoDate}
      className={cn(
        'flex size-9 items-center justify-center rounded-md text-sm tabular-nums outline-none transition-colors',
        'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60',
        modifiers.outside && 'text-muted-foreground/55',
        modifiers.today && !modifiers.selected && 'font-semibold text-primary-fg',
        modifiers.range_middle && 'rounded-none text-foreground hover:bg-primary/15',
        edge && 'bg-primary font-medium text-primary-foreground hover:bg-primary/90',
        modifiers.disabled && 'pointer-events-none opacity-35',
        className,
      )}
      {...props}
    />
  );
}

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/** DayPicker styled with the design tokens (single, multiple and range modes). */
export function Calendar({ className, classNames, showOutsideDays = true, components, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row sm:gap-6',
        month: 'flex w-full flex-col gap-3',
        nav: 'absolute inset-x-0 top-0 z-10 flex items-center justify-between',
        button_previous: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'aria-disabled:opacity-40'),
        button_next: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'aria-disabled:opacity-40'),
        month_caption: 'flex h-8 items-center justify-center px-10',
        caption_label: 'text-sm font-medium',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 pb-1 text-[11px] font-medium text-muted-foreground uppercase',
        week: 'mt-1 flex w-full',
        day: 'relative size-9 p-0 text-center',
        range_start: 'rounded-l-md bg-primary/12',
        range_middle: 'bg-primary/12',
        range_end: 'rounded-r-md bg-primary/12',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('size-4', chevronClass)} />
          ) : (
            <ChevronRight className={cn('size-4', chevronClass)} />
          ),
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}
