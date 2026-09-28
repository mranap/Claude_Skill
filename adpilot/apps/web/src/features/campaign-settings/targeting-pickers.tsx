'use client';

import { Check, ChevronsUpDown, ExternalLink, LoaderCircle, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { MultiCombobox } from '@/components/ui/multi-combobox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { FieldControlProps } from '@/components/shared/form';
import { getErrorMessage, isApiError } from '@/lib/api/errors';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { cn } from '@/lib/utils/cn';
import { humanize } from '@/lib/utils/strings';
import {
  INTEREST_MIN_QUERY,
  useInterestSearch,
  useLeadForms,
  useLocales,
  type InterestHit,
} from '../ad-accounts/targeting';
import { OptionalInput, SelectInput } from './fields';

type Locale = { key: number; name: string };
type Interest = { id: string; name: string };

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** "1.2M–1.5M" from Meta's audience size bounds. */
export function audienceRange(lower: number | null, upper: number | null): string | null {
  if (lower === null && upper === null) return null;
  if (lower !== null && upper !== null && lower !== upper)
    return `${compact.format(lower)}–${compact.format(upper)}`;
  return compact.format((upper ?? lower) as number);
}

/** Category path without the interest itself: "Interests › Fitness and wellness". */
function interestCategory(hit: InterestHit): string {
  const path = hit.path.at(-1) === hit.name ? hit.path.slice(0, -1) : hit.path;
  return path.join(' › ');
}

function ManualToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-fit text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {open ? 'Hide manual entry' : label}
    </button>
  );
}

// ───────────── Languages ─────────────

/**
 * Languages from Meta's targetable locales (loaded once per ad account, filtered in the browser). Stored as
 * `{ key, name }`; keys can still be entered by hand when the list is unavailable.
 */
export function LocalePicker({
  value,
  onChange,
  adAccountId,
  disabled,
  controlProps,
  placeholder = 'All languages',
}: {
  value: Locale[];
  onChange: (value: Locale[]) => void;
  adAccountId: string | null | undefined;
  disabled?: boolean;
  controlProps?: FieldControlProps;
  placeholder?: string;
}) {
  const locales = useLocales(adAccountId);
  const [manual, setManual] = useState(false);
  const options = useMemo(() => {
    const list = (locales.data ?? []).map((l) => ({
      value: String(l.key),
      label: l.name,
      hint: `#${l.key}`,
    }));
    const known = new Set(list.map((o) => o.value));
    // Stored languages stay visible (with their stored name) even when the list is unavailable.
    for (const v of value) {
      if (!known.has(String(v.key))) list.push({ value: String(v.key), label: v.name, hint: `#${v.key}` });
    }
    return list;
  }, [locales.data, value]);

  const unavailable = !adAccountId
    ? 'Connect an ad account to search languages, or enter locale keys manually.'
    : locales.error
      ? `Languages could not be loaded: ${getErrorMessage(locales.error)}`
      : null;
  const showManual = manual || (!!unavailable && !disabled);

  return (
    <div className="grid gap-2">
      <MultiCombobox
        {...controlProps}
        value={value.map((v) => String(v.key))}
        onValueChange={(keys) =>
          onChange(
            keys.map(
              (k) =>
                value.find((v) => String(v.key) === k) ?? {
                  key: Number(k),
                  name: options.find((o) => o.value === k)?.label ?? `Locale ${k}`,
                },
            ),
          )
        }
        options={options}
        placeholder={locales.isLoading ? 'Loading languages…' : placeholder}
        addLabel="Add language"
        searchPlaceholder="Search languages"
        emptyText={unavailable ?? 'No language found'}
        disabled={disabled}
      />
      {unavailable ? <p className="text-xs text-muted-foreground">{unavailable}</p> : null}
      {!disabled && !unavailable ? (
        <ManualToggle open={manual} onToggle={() => setManual((v) => !v)} label="Enter a locale key manually" />
      ) : null}
      {showManual ? (
        <PairListEditor
          value={value}
          onChange={onChange}
          idKey="key"
          numeric
          idLabel="Locale key"
          nameLabel="Language"
          disabled={disabled}
          showChips={false}
          docsHref="https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search#locales"
        />
      ) : null}
    </div>
  );
}

// ───────────── Interests ─────────────

/**
 * Detailed targeting search (Meta Targeting Search, debounced). Results show the category path and the
 * estimated audience size; the selection is stored as `{ id, name }`.
 */
export function InterestPicker({
  value,
  onChange,
  adAccountId,
  disabled,
  controlProps,
}: {
  value: Interest[];
  onChange: (value: Interest[]) => void;
  adAccountId: string | null | undefined;
  disabled?: boolean;
  controlProps?: FieldControlProps;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState(false);
  const debounced = useDebouncedValue(query.trim(), 300);
  const tooShort = debounced.length < INTEREST_MIN_QUERY;
  const search = useInterestSearch(adAccountId, debounced);
  const hits = !tooShort ? (search.data ?? []) : [];
  const selected = new Set(value.map((v) => v.id));

  const toggle = (hit: Interest) =>
    onChange(
      selected.has(hit.id) ? value.filter((v) => v.id !== hit.id) : [...value, { id: hit.id, name: hit.name }],
    );

  const status: React.ReactNode = tooShort ? (
    `Type at least ${INTEREST_MIN_QUERY} characters to search Meta's interests.`
  ) : search.error ? (
    isApiError(search.error, 'RATE_LIMITED', 'META_RATE_LIMITED') ? (
      `Too many searches. ${search.error.retryAfterSeconds ? `Try again in ${search.error.retryAfterSeconds} s.` : 'Try again in a moment.'}`
    ) : (
      getErrorMessage(search.error)
    )
  ) : search.isFetching && !search.data ? (
    <span className="inline-flex items-center gap-2">
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Searching…
    </span>
  ) : (
    `No interests found for “${debounced}”.`
  );

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-field px-1.5 py-1 text-sm',
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
          controlProps?.['aria-invalid'] && 'border-destructive/70',
          disabled && 'cursor-not-allowed opacity-55',
        )}
      >
        {value.map((v) => (
          <span
            key={v.id}
            title={`${v.name} · ${v.id}`}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded bg-secondary pr-0.5 pl-2 text-xs font-medium text-secondary-foreground"
          >
            <span className="truncate">{v.name}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggle(v)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={`Remove ${v.name}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery('');
          }}
        >
          <PopoverTrigger asChild disabled={disabled || !adAccountId}>
            <button
              {...controlProps}
              type="button"
              role="combobox"
              aria-expanded={open}
              className={cn(
                'flex h-6 min-w-24 flex-1 items-center justify-between gap-2 rounded px-1.5 text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                value.length ? 'text-xs' : 'text-sm',
              )}
            >
              <span className="truncate">
                {!adAccountId ? 'Search unavailable' : value.length ? 'Add interest' : 'Broad targeting (no interests)'}
              </span>
              <ChevronsUpDown className="size-4 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search interests, e.g. yoga"
                value={query}
                onValueChange={setQuery}
                trailing={
                  search.isFetching && !tooShort ? (
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                  ) : null
                }
              />
              <CommandList>
                <CommandEmpty className="px-3 py-4 text-left text-xs text-muted-foreground">{status}</CommandEmpty>
                {hits.length ? (
                  <CommandGroup>
                    {hits.map((hit) => {
                      const range = audienceRange(hit.audienceSizeLower, hit.audienceSizeUpper);
                      const category = interestCategory(hit);
                      return (
                        <CommandItem key={hit.id} value={hit.id} onSelect={() => toggle(hit)}>
                          <Check
                            className={cn('size-4 shrink-0', selected.has(hit.id) ? 'opacity-100' : 'opacity-0')}
                          />
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="truncate">{hit.name}</span>
                            {category ? (
                              <span className="truncate text-xs text-muted-foreground">{category}</span>
                            ) : null}
                          </span>
                          {range ? (
                            <span
                              className="ml-2 shrink-0 text-xs text-muted-foreground tabular-nums"
                              title="Estimated audience size"
                            >
                              {range}
                            </span>
                          ) : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {!adAccountId ? (
        <p className="text-xs text-muted-foreground">
          Connect an ad account to search interests, or enter interest IDs manually.
        </p>
      ) : null}
      {!disabled && adAccountId ? (
        <ManualToggle open={manual} onToggle={() => setManual((v) => !v)} label="Enter an interest ID manually" />
      ) : null}
      {manual || (!adAccountId && !disabled) ? (
        <PairListEditor
          value={value}
          onChange={onChange}
          idKey="id"
          idLabel="Interest ID"
          nameLabel="Interest name"
          disabled={disabled}
          showChips={false}
          docsHref="https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting#interests"
        />
      ) : null}
    </div>
  );
}

// ───────────── Instant Forms ─────────────

const DEFAULT_FORM = '__default__';

/**
 * Instant Form of the chosen Page (lead ads). Only ACTIVE forms can be selected; archived and draft forms are
 * listed but disabled. Without a Page, an ad account or permission to list forms, the form ID is typed in.
 */
export function LeadFormSelect({
  value,
  onChange,
  adAccountId,
  pageId,
  disabled,
  controlProps,
  defaultLabel,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  adAccountId: string | null | undefined;
  pageId: string | null | undefined;
  disabled?: boolean;
  controlProps?: FieldControlProps;
  /** Adds an option that clears the value (per-ad override: "use the default form"). */
  defaultLabel?: string;
}) {
  const forms = useLeadForms(adAccountId, pageId);
  const [manual, setManual] = useState(false);
  const reason = !adAccountId
    ? 'Choose an ad account to list the Instant Forms of its Pages.'
    : !pageId
      ? 'Choose the Facebook Page first to list its Instant Forms.'
      : null;
  const noForms = forms.isSuccess && forms.data.length === 0;

  if (manual || reason || forms.error || noForms) {
    return (
      <div className="grid gap-1.5">
        <OptionalInput
          controlProps={controlProps}
          value={value}
          onChange={onChange}
          inputMode="numeric"
          placeholder={defaultLabel ? 'Default form' : 'Instant form ID'}
          disabled={disabled}
        />
        {forms.error ? (
          <p className="text-xs text-destructive-fg">{getErrorMessage(forms.error)}</p>
        ) : reason ? (
          <p className="text-xs text-muted-foreground">{reason}</p>
        ) : noForms ? (
          <p className="text-xs text-muted-foreground">
            This Page has no Instant Forms yet. Create one in Meta Business Suite, or paste a form ID.
          </p>
        ) : null}
        {manual && forms.data?.length ? (
          <button
            type="button"
            onClick={() => setManual(false)}
            className="w-fit text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Choose from this Page’s forms
          </button>
        ) : null}
      </div>
    );
  }

  const known = new Set((forms.data ?? []).map((f) => f.id));
  const options = [
    ...(defaultLabel ? [{ value: DEFAULT_FORM, label: defaultLabel }] : []),
    ...(forms.data ?? []).map((f) => ({
      value: f.id,
      label: f.name,
      description: [f.status !== 'ACTIVE' ? humanize(f.status) : null, f.locale, f.id].filter(Boolean).join(' · '),
      disabled: f.status !== 'ACTIVE',
    })),
    ...(value && !known.has(value)
      ? [{ value, label: `Form ${value}`, description: 'Not found among this Page’s forms' }]
      : []),
  ];

  return (
    <div className="grid gap-1.5">
      <SelectInput
        controlProps={controlProps}
        value={value ?? (defaultLabel ? DEFAULT_FORM : undefined)}
        onChange={(v) => onChange(v === DEFAULT_FORM ? undefined : v)}
        options={options}
        placeholder={forms.isLoading ? 'Loading forms…' : 'Choose an Instant Form'}
        disabled={disabled || forms.isLoading}
      />
      {!disabled ? (
        <ManualToggle open={false} onToggle={() => setManual(true)} label="Enter a form ID instead" />
      ) : null}
    </div>
  );
}

// ───────────── Manual entry ─────────────

type Pair<K extends 'key' | 'id'> = K extends 'key' ? { key: number; name: string } : { id: string; name: string };

/** Editable list of `{ key|id, name }` pairs entered by ID (fallback when the look-ups are unavailable). */
export function PairListEditor<K extends 'key' | 'id'>({
  value,
  onChange,
  idKey,
  numeric = false,
  idLabel,
  nameLabel,
  disabled,
  docsHref,
  showChips = true,
}: {
  value: Pair<K>[];
  onChange: (value: Pair<K>[]) => void;
  idKey: K;
  numeric?: boolean;
  idLabel: string;
  nameLabel: string;
  disabled?: boolean;
  docsHref?: string;
  /** Off when a picker above already shows the selection as chips. */
  showChips?: boolean;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const valid = numeric ? /^\d{1,9}$/.test(id) && Number(id) > 0 : /^\d{1,30}$/.test(id);
  const add = () => {
    if (!valid) return;
    const item = (
      idKey === 'key'
        ? { key: Number(id), name: name.trim() || `Locale ${id}` }
        : { id, name: name.trim() || id }
    ) as Pair<K>;
    const exists = value.some((v) => String((v as Record<string, unknown>)[idKey]) === id);
    if (!exists) onChange([...value, item]);
    setId('');
    setName('');
  };
  return (
    <div className="grid gap-2">
      {showChips && value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => {
            const k = String((v as Record<string, unknown>)[idKey]);
            return (
              <span
                key={k}
                className="inline-flex h-6 items-center gap-1 rounded bg-secondary pr-0.5 pl-2 text-xs font-medium"
              >
                {v.name} <span className="font-mono text-muted-foreground">{k}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange(value.filter((x) => String((x as Record<string, unknown>)[idKey]) !== k))
                  }
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${v.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={id}
          onChange={(e) => setId(e.target.value.replace(/\D/g, ''))}
          placeholder={idLabel}
          inputMode="numeric"
          className="h-8 w-32"
          aria-label={idLabel}
          disabled={disabled}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={nameLabel}
          className="h-8 min-w-40 flex-1"
          aria-label={nameLabel}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled || !valid}>
          <Plus />
          Add
        </Button>
        {docsHref ? (
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Find IDs <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
