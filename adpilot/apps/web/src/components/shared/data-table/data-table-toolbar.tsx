'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import type { TableController } from './use-table-state';

/** Debounced search box bound to `state.q`. */
export function TableSearch({
  state,
  placeholder = 'Search…',
  className,
  debounceMs = 350,
}: {
  state: TableController;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}) {
  const [value, setValue] = useState(state.q);
  /** Last query we sent or received; a different `state.q` means an external change (reset, back). */
  const [synced, setSynced] = useState(state.q);
  const { setQuery } = state;

  if (state.q !== synced) {
    setSynced(state.q);
    setValue(state.q);
  }

  const submit = (next: string) => {
    setSynced(next.trim());
    setQuery(next);
  };

  useEffect(() => {
    if (value.trim() === synced) return;
    const id = window.setTimeout(() => {
      setSynced(value.trim());
      setQuery(value);
    }, debounceMs);
    return () => window.clearTimeout(id);
  }, [value, synced, debounceMs, setQuery]);

  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit(value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 pr-8 pl-8 text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue('');
            submit('');
          }}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

const ALL = '__all__';

/** Single-value filter bound to `state.filters[filterKey]`. */
export function FilterSelect({
  state,
  filterKey,
  options,
  allLabel,
  className,
  'aria-label': ariaLabel,
}: {
  state: TableController;
  filterKey: string;
  options: FilterOption[];
  allLabel: string;
  className?: string;
  'aria-label'?: string;
}) {
  const value = state.filters[filterKey] ?? ALL;
  return (
    <Select value={value} onValueChange={(v) => state.setFilter(filterKey, v === ALL ? undefined : v)}>
      <SelectTrigger
        size="sm"
        className={cn('w-auto min-w-36 gap-2', value !== ALL && 'border-primary/40', className)}
        aria-label={ariaLabel ?? allLabel}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Row above a table: search, filters, reset and right-aligned actions. */
export function DataTableToolbar({
  state,
  searchPlaceholder,
  filters,
  actions,
  className,
  hideSearch = false,
}: {
  state: TableController;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  hideSearch?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {!hideSearch ? <TableSearch state={state} placeholder={searchPlaceholder} /> : null}
        {filters}
        {state.hasActiveFilters ? (
          <Button variant="ghost" size="sm" onClick={state.reset} className="text-muted-foreground">
            <X />
            Reset
          </Button>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
