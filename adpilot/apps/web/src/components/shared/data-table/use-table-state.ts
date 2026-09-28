'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface TableState {
  page: number;
  pageSize: number;
  q: string;
  /** "field:asc" | "field:desc" */
  sort: string | undefined;
  filters: Record<string, string | undefined>;
}

export interface TableController extends TableState {
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setQuery: (q: string) => void;
  setSort: (sort: string | undefined) => void;
  setFilter: (key: string, value: string | undefined) => void;
  setFilters: (patch: Record<string, string | undefined>) => void;
  reset: () => void;
  /** Query parameters for the list endpoint (`page`, `pageSize`, `q`, `sort` + filters). */
  params: Record<string, string | number>;
  /** True when search or any filter is set. */
  hasActiveFilters: boolean;
  /** Changes whenever the visible page changes (used to reset row selection). */
  key: string;
}

export interface TableStateOptions {
  filterKeys?: readonly string[];
  defaultPageSize?: number;
  defaultSort?: string;
}

function toInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function buildController(
  state: TableState,
  apply: (patch: Partial<Record<string, string | number | undefined>>, resetPage: boolean) => void,
  resetAll: () => void,
): TableController {
  const params: Record<string, string | number> = { page: state.page, pageSize: state.pageSize };
  if (state.q) params.q = state.q;
  if (state.sort) params.sort = state.sort;
  for (const [key, value] of Object.entries(state.filters)) if (value) params[key] = value;
  const hasActiveFilters = !!state.q || Object.values(state.filters).some(Boolean);
  return {
    ...state,
    params,
    hasActiveFilters,
    key: JSON.stringify(params),
    setPage: (page) => apply({ page }, false),
    setPageSize: (pageSize) => apply({ pageSize }, true),
    setQuery: (q) => apply({ q: q.trim() || undefined }, true),
    setSort: (sort) => apply({ sort }, true),
    setFilter: (key, value) => apply({ [key]: value }, true),
    setFilters: (patch) => apply(patch, true),
    reset: resetAll,
  };
}

/**
 * Server-side table state stored in the URL (`?page=&pageSize=&q=&sort=&<filters>`), so views are
 * shareable, survive reloads and work with the browser's back button.
 */
export function useUrlTableState(options: TableStateOptions = {}): TableController {
  const { filterKeys = [], defaultPageSize = 25, defaultSort } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Callers often pass inline arrays; key the memoisation on the joined names instead of the array identity.
  const filterKeysKey = filterKeys.join('|');

  const state = useMemo<TableState>(() => {
    const keys = filterKeysKey ? filterKeysKey.split('|') : [];
    const size = toInt(searchParams.get('pageSize'), defaultPageSize, 1, 200);
    return {
      page: toInt(searchParams.get('page'), 1, 1, 100_000),
      pageSize: (PAGE_SIZE_OPTIONS as readonly number[]).includes(size) ? size : defaultPageSize,
      q: searchParams.get('q') ?? '',
      sort: searchParams.get('sort') ?? defaultSort,
      filters: Object.fromEntries(keys.map((k) => [k, searchParams.get(k) ?? undefined])),
    };
  }, [searchParams, defaultPageSize, defaultSort, filterKeysKey]);

  const apply = useCallback(
    (patch: Partial<Record<string, string | number | undefined>>, resetPage: boolean) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      if (resetPage) next.delete('page');
      if (next.get('page') === '1') next.delete('page');
      if (next.get('pageSize') === String(defaultPageSize)) next.delete('pageSize');
      if (defaultSort && next.get('sort') === defaultSort) next.delete('sort');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, defaultPageSize, defaultSort],
  );

  const resetAll = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of ['page', 'q', ...(filterKeysKey ? filterKeysKey.split('|') : [])]) next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname, filterKeysKey]);

  return useMemo(() => buildController(state, apply, resetAll), [state, apply, resetAll]);
}

/** Same controller API kept in component state (for tables embedded in a page section). */
export function useLocalTableState(options: TableStateOptions = {}): TableController {
  const { filterKeys = [], defaultPageSize = 10, defaultSort } = options;
  const initial = (): TableState => ({
    page: 1,
    pageSize: defaultPageSize,
    q: '',
    sort: defaultSort,
    filters: Object.fromEntries(filterKeys.map((k) => [k, undefined])),
  });
  const [state, setState] = useState<TableState>(initial);

  const apply = useCallback((patch: Partial<Record<string, string | number | undefined>>, resetPage: boolean) => {
    setState((prev) => {
      const next: TableState = { ...prev, filters: { ...prev.filters } };
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'page') next.page = Number(value) || 1;
        else if (key === 'pageSize') next.pageSize = Number(value) || prev.pageSize;
        else if (key === 'q') next.q = value === undefined ? '' : String(value);
        else if (key === 'sort') next.sort = value === undefined ? defaultSort : String(value);
        else next.filters[key] = value === undefined || value === '' ? undefined : String(value);
      }
      if (resetPage) next.page = 1;
      return next;
    });
  }, [defaultSort]);

  const resetAll = useCallback(() => {
    setState((prev) => ({ ...prev, page: 1, q: '', filters: Object.fromEntries(Object.keys(prev.filters).map((k) => [k, undefined])) }));
  }, []);

  return useMemo(() => buildController(state, apply, resetAll), [state, apply, resetAll]);
}
