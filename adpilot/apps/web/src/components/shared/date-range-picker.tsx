'use client';

import { endOfDay, format, isSameDay, isSameYear, startOfDay, subDays } from 'date-fns';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { cn } from '@/lib/utils/cn';

export type DateRangePreset = 'today' | 'yesterday' | 'last3' | 'last7' | 'last14' | 'last30' | 'custom';

export interface DateRangeValue {
  preset: DateRangePreset;
  from: Date;
  to: Date;
}

interface PresetDef {
  key: Exclude<DateRangePreset, 'custom'>;
  label: string;
  days?: number;
}

export const DATE_RANGE_PRESETS: PresetDef[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last3', label: 'Last 3 days', days: 3 },
  { key: 'last7', label: 'Last 7 days', days: 7 },
  { key: 'last14', label: 'Last 14 days', days: 14 },
  { key: 'last30', label: 'Last 30 days', days: 30 },
];

/**
 * Resolves a preset to concrete dates. By default "Last N days" follows Meta Ads Manager semantics
 * (N complete days ending yesterday); pass `includeToday` for operational views such as logs.
 */
export function resolvePreset(
  preset: Exclude<DateRangePreset, 'custom'>,
  includeToday = false,
  now = new Date(),
): { from: Date; to: Date } {
  if (preset === 'today') return { from: startOfDay(now), to: endOfDay(now) };
  if (preset === 'yesterday') {
    const y = subDays(now, 1);
    return { from: startOfDay(y), to: endOfDay(y) };
  }
  const days = DATE_RANGE_PRESETS.find((p) => p.key === preset)?.days ?? 7;
  const end = includeToday ? now : subDays(now, 1);
  return { from: startOfDay(subDays(end, days - 1)), to: endOfDay(end) };
}

export function formatRangeLabel(value: DateRangeValue | null | undefined, emptyLabel = 'Any time'): string {
  if (!value) return emptyLabel;
  if (value.preset !== 'custom')
    return DATE_RANGE_PRESETS.find((p) => p.key === value.preset)?.label ?? emptyLabel;
  if (isSameDay(value.from, value.to)) return format(value.from, 'MMM d, yyyy');
  const sameYear = isSameYear(value.from, value.to);
  return `${format(value.from, sameYear ? 'MMM d' : 'MMM d, yyyy')} – ${format(value.to, 'MMM d, yyyy')}`;
}

export function DateRangePicker({
  value,
  onChange,
  includeToday = false,
  allowClear = true,
  emptyLabel = 'Any time',
  disableFuture = true,
  align = 'start',
  className,
}: {
  value: DateRangeValue | null;
  onChange: (value: DateRangeValue | null) => void;
  includeToday?: boolean;
  allowClear?: boolean;
  emptyLabel?: string;
  disableFuture?: boolean;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const wide = useMediaQuery('(min-width: 640px)');

  const selectPreset = (key: Exclude<DateRangePreset, 'custom'>) => {
    onChange({ preset: key, ...resolvePreset(key, includeToday) });
    setOpen(false);
  };

  const applyCustom = () => {
    if (!draft?.from) return;
    onChange({ preset: 'custom', from: startOfDay(draft.from), to: endOfDay(draft.to ?? draft.from) });
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(value ? { from: value.from, to: value.to } : undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('justify-start font-normal', className)}>
          <CalendarDays className="text-muted-foreground" />
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {formatRangeLabel(value, emptyLabel)}
          </span>
          <ChevronDown className="ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto max-w-[calc(100vw-2rem)] p-0">
        <div className="flex flex-col sm:flex-row">
          {/* On phones the preset row scrolls horizontally; `w-0 min-w-full` keeps it from widening the popover */}
          <div className="flex w-0 min-w-full gap-1 overflow-x-auto border-b p-2 sm:w-40 sm:min-w-0 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0">
            {allowClear ? (
              <PresetButton
                active={!value}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {emptyLabel}
              </PresetButton>
            ) : null}
            {DATE_RANGE_PRESETS.map((preset) => (
              <PresetButton
                key={preset.key}
                active={value?.preset === preset.key}
                onClick={() => selectPreset(preset.key)}
              >
                {preset.label}
              </PresetButton>
            ))}
            <PresetButton active={value?.preset === 'custom'} onClick={() => undefined}>
              Custom
            </PresetButton>
          </div>
          <div className="flex flex-col">
            <Calendar
              mode="range"
              numberOfMonths={wide ? 2 : 1}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from ?? subDays(new Date(), wide ? 30 : 0)}
              disabled={disableFuture ? { after: new Date() } : undefined}
              weekStartsOn={1}
            />
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2.5">
              <span className="text-xs text-muted-foreground tabular-nums">
                {draft?.from
                  ? formatRangeLabel({ preset: 'custom', from: draft.from, to: draft.to ?? draft.from })
                  : 'Pick a start and end date'}
              </span>
              <div className="flex gap-2">
                {draft?.from ? (
                  <Button variant="ghost" size="xs" onClick={() => setDraft(undefined)}>
                    <X />
                    Reset
                  </Button>
                ) : null}
                <Button size="xs" onClick={applyCustom} disabled={!draft?.from}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-md px-2.5 py-1.5 text-left text-[13px] whitespace-nowrap outline-none transition-colors',
        'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Serialises a range for list endpoints that accept `from`/`to` ISO timestamps. */
export function rangeToQuery(value: DateRangeValue | null): { from?: string; to?: string } {
  if (!value) return {};
  return { from: value.from.toISOString(), to: value.to.toISOString() };
}

/** Compact URL representation: "last7" or "2026-09-01_2026-09-07". */
export function serializeRange(value: DateRangeValue | null): string | undefined {
  if (!value) return undefined;
  if (value.preset !== 'custom') return value.preset;
  return `${format(value.from, 'yyyy-MM-dd')}_${format(value.to, 'yyyy-MM-dd')}`;
}

export function parseRange(raw: string | null | undefined, includeToday = false): DateRangeValue | null {
  if (!raw) return null;
  const preset = DATE_RANGE_PRESETS.find((p) => p.key === raw);
  if (preset) return { preset: preset.key, ...resolvePreset(preset.key, includeToday) };
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (!match) return null;
  const from = new Date(`${match[1]}T00:00:00`);
  const to = new Date(`${match[2]}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { preset: 'custom', from: startOfDay(from), to: endOfDay(to) };
}
