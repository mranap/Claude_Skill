'use client';

import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from './command';
import type { ComboboxOption } from './combobox';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface MultiComboboxPreset {
  label: string;
  values: string[];
}

/**
 * Searchable multi-select rendered as removable chips (countries, audiences, campaigns…).
 * Chips live outside the trigger button so each remove button is its own focusable control.
 */
export function MultiCombobox({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  addLabel = 'Add',
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  presets,
  disabled,
  className,
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  maxResults = 100,
  chipLabel,
  maxChips = 12,
}: {
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  addLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Quick actions shown above the options (e.g. "All EU countries"). */
  presets?: MultiComboboxPreset[];
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  maxResults?: number;
  /** Chip text (defaults to the option label). */
  chipLabel?: (option: ComboboxOption) => React.ReactNode;
  maxChips?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const selected = new Set(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter(
          (o) =>
            o.value.toLowerCase().includes(q) ||
            o.label.toLowerCase().includes(q) ||
            o.hint?.toLowerCase().includes(q) ||
            o.keywords?.some((k) => k.toLowerCase().includes(q)),
        )
      : options;
    return list.slice(0, maxResults);
  }, [options, query, maxResults]);

  const toggle = (v: string) => {
    onValueChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  const visible = expanded ? value : value.slice(0, maxChips);
  const hidden = value.length - visible.length;

  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-field px-1.5 py-1 text-sm',
        'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
        ariaInvalid && 'border-destructive/70',
        disabled && 'cursor-not-allowed opacity-55',
        className,
      )}
    >
      {visible.map((v) => {
        const option = byValue.get(v) ?? { value: v, label: v };
        return (
          <span
            key={v}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded bg-secondary pr-0.5 pl-2 text-xs font-medium text-secondary-foreground"
          >
            <span className="truncate">{chipLabel ? chipLabel(option) : option.label}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggle(v)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={`Remove ${option.label}`}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="h-6 rounded px-1.5 text-xs font-medium text-primary-fg hover:underline"
        >
          +{hidden} more
        </button>
      ) : null}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverTrigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            className={cn(
              'flex h-6 min-w-24 flex-1 items-center justify-between gap-2 rounded px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              value.length ? 'text-xs text-muted-foreground' : 'text-sm text-muted-foreground',
            )}
          >
            <span className="truncate">{value.length ? addLabel : placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {presets?.length && !query ? (
                <>
                  <CommandGroup heading="Quick add">
                    {presets.map((preset) => (
                      <CommandItem
                        key={preset.label}
                        value={`preset:${preset.label}`}
                        onSelect={() => onValueChange([...new Set([...value, ...preset.values])])}
                      >
                        <span className="truncate">{preset.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {preset.values.length}
                        </span>
                      </CommandItem>
                    ))}
                    {value.length ? (
                      <CommandItem value="preset:clear" onSelect={() => onValueChange([])}>
                        <span className="text-destructive-fg">Clear selection</span>
                      </CommandItem>
                    ) : null}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              ) : null}
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem key={option.value} value={option.value} onSelect={() => toggle(option.value)}>
                    <Check
                      className={cn('size-4', selected.has(option.value) ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {option.hint}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
