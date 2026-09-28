'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils/cn';
import { DateRangePicker, parseRange, serializeRange } from '../date-range-picker';
import type { TableController } from './use-table-state';

/** Debounced free-text filter bound to `state.filters[filterKey]` (e.g. log source, Meta category). */
export function TextFilter({
  state,
  filterKey,
  placeholder,
  className,
  debounceMs = 400,
}: {
  state: TableController;
  filterKey: string;
  placeholder: string;
  className?: string;
  debounceMs?: number;
}) {
  const external = state.filters[filterKey] ?? '';
  const [value, setValue] = useState(external);
  const [synced, setSynced] = useState(external);
  const { setFilter } = state;

  if (external !== synced) {
    setSynced(external);
    setValue(external);
  }

  useEffect(() => {
    if (value.trim() === synced) return;
    const id = window.setTimeout(() => {
      setSynced(value.trim());
      setFilter(filterKey, value.trim() || undefined);
    }, debounceMs);
    return () => window.clearTimeout(id);
  }, [value, synced, debounceMs, setFilter, filterKey]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn('h-8 w-40 text-[13px]', value && 'border-primary/40', className)}
    />
  );
}

/** Date range filter stored in the URL as `range=last7` or `range=2026-09-01_2026-09-07`. */
export function DateRangeFilter({
  state,
  filterKey = 'range',
  includeToday = true,
}: {
  state: TableController;
  filterKey?: string;
  includeToday?: boolean;
}) {
  const value = parseRange(state.filters[filterKey], includeToday);
  return (
    <DateRangePicker
      value={value}
      onChange={(next) => state.setFilter(filterKey, serializeRange(next))}
      includeToday={includeToday}
      className={cn('h-8', value && 'border-primary/40')}
    />
  );
}

/** Boolean filter rendered as a small switch (`value` stored as "true"). */
export function ToggleFilter({ state, filterKey, label }: { state: TableController; filterKey: string; label: string }) {
  const checked = state.filters[filterKey] === 'true';
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border bg-field px-2.5 text-[13px]">
      <Switch checked={checked} onCheckedChange={(v) => state.setFilter(filterKey, v ? 'true' : undefined)} className="scale-90" />
      {label}
    </label>
  );
}
