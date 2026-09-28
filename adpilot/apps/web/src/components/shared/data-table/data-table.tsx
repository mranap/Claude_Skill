'use client';

import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Inbox } from 'lucide-react';
import { Fragment, useState } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { EmptyState } from '../empty-state';
import { ErrorAlert } from '../error-alert';
import { DataTablePagination } from './data-table-pagination';
import type { TableController } from './use-table-state';

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  /** Server field used for `sort=<field>:asc|desc`; makes the header clickable. */
  sortField?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  headerClassName?: string;
  /** Cell content handles its own clicks (menus, buttons): row click/expand is not triggered. */
  interactive?: boolean;
}

export interface BulkActionContext<T> {
  selected: T[];
  clear: () => void;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  total?: number;
  /** Pagination/sorting controller (URL or local). Omit for static tables. */
  state?: TableController;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  /** Enables row checkboxes and the bulk-action bar. */
  selectable?: boolean;
  isRowSelectable?: (row: T) => boolean;
  bulkActions?: (ctx: BulkActionContext<T>) => React.ReactNode;
  /** Expandable rows (click the row or the chevron). */
  renderExpanded?: (row: T) => React.ReactNode;
  emptyState?: React.ReactNode;
  toolbar?: React.ReactNode;
  stickyHeader?: boolean;
  minWidth?: number;
  className?: string;
  'aria-label'?: string;
  rowClassName?: (row: T) => string | undefined;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (direction === 'asc') return <ArrowUp className="size-3.5 text-foreground" aria-hidden />;
  if (direction === 'desc') return <ArrowDown className="size-3.5 text-foreground" aria-hidden />;
  return <ChevronsUpDown className="size-3.5 opacity-50 group-hover/sort:opacity-100" aria-hidden />;
}

/**
 * Server-driven data table: sorting, pagination, search and filters live in a `TableController`
 * (typically bound to the URL), the parent fetches the matching page with TanStack Query.
 */
export function DataTable<T>({
  columns,
  data,
  total,
  state,
  getRowId,
  isLoading = false,
  isFetching = false,
  error,
  onRetry,
  onRowClick,
  selectable = false,
  isRowSelectable,
  bulkActions,
  renderExpanded,
  emptyState,
  toolbar,
  stickyHeader = true,
  minWidth = 720,
  className,
  'aria-label': ariaLabel,
  rowClassName,
}: DataTableProps<T>) {
  const selectionKey = state?.key ?? 'static';
  const [selection, setSelection] = useState<{ key: string; rows: Map<string, T> }>({
    key: selectionKey,
    rows: new Map(),
  });
  const selected = selection.key === selectionKey ? selection.rows : new Map<string, T>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = data ?? [];
  const selectableRows = rows.filter((r) => !isRowSelectable || isRowSelectable(r));
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(getRowId(r)));
  const someSelected = !allSelected && selectableRows.some((r) => selected.has(getRowId(r)));
  const expandable = !!renderExpanded;
  const colCount = columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0);
  const clear = () => setSelection({ key: selectionKey, rows: new Map() });

  const toggleRow = (row: T, checked: boolean) => {
    const next = new Map(selected);
    if (checked) next.set(getRowId(row), row);
    else next.delete(getRowId(row));
    setSelection({ key: selectionKey, rows: next });
  };

  const toggleAll = (checked: boolean) => {
    const next = new Map<string, T>();
    if (checked) for (const r of selectableRows) next.set(getRowId(r), r);
    setSelection({ key: selectionKey, rows: next });
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortState = (field: string): 'asc' | 'desc' | null => {
    if (!state?.sort) return null;
    const [f, dir] = state.sort.split(':');
    return f === field ? (dir === 'desc' ? 'desc' : 'asc') : null;
  };

  const cycleSort = (field: string) => {
    if (!state) return;
    const current = sortState(field);
    state.setSort(current === null ? `${field}:asc` : current === 'asc' ? `${field}:desc` : undefined);
  };

  const showSkeleton = isLoading && !data;
  const showError = !!error && !data;
  const rowActivate = (row: T) => {
    if (onRowClick) onRowClick(row);
    else if (expandable) toggleExpanded(getRowId(row));
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {toolbar}
      <div className="relative overflow-hidden rounded-lg border bg-card">
        {isFetching && data ? (
          <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden" aria-hidden>
            <div className="h-full w-2/5 animate-indeterminate bg-primary/70" />
          </div>
        ) : null}

        {selectable && selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-primary/[0.05] px-4 py-2 text-sm">
            <span className="font-medium tabular-nums">{selected.size} selected</span>
            <div className="flex flex-wrap items-center gap-2">
              {bulkActions?.({ selected: [...selected.values()], clear })}
            </div>
            <Button variant="ghost" size="xs" className="ml-auto" onClick={clear}>
              Clear selection
            </Button>
          </div>
        ) : null}

        {error && data ? (
          <ErrorAlert error={error} onRetry={onRetry} className="rounded-none border-x-0 border-t-0" />
        ) : null}

        {showError ? (
          <div className="p-4">
            <ErrorAlert error={error} onRetry={onRetry} />
          </div>
        ) : (
          <Table
            aria-label={ariaLabel}
            aria-busy={isLoading || isFetching}
            style={{ minWidth }}
            containerClassName={cn(stickyHeader && 'md:max-h-[min(70vh,52rem)] md:overflow-y-auto')}
            className={cn(isFetching && data && 'opacity-70 transition-opacity')}
          >
            <TableHeader className={cn(stickyHeader && 'sticky top-0 z-10')}>
              <TableRow className="hover:bg-transparent">
                {selectable ? (
                  <TableHead className="w-10 bg-surface-subtle">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      aria-label="Select all rows on this page"
                      disabled={!selectableRows.length}
                    />
                  </TableHead>
                ) : null}
                {expandable ? <TableHead className="w-8 bg-surface-subtle" aria-label="Expand" /> : null}
                {columns.map((column) => {
                  const direction = column.sortField ? sortState(column.sortField) : null;
                  return (
                    <TableHead
                      key={column.id}
                      className={cn(
                        'bg-surface-subtle',
                        ALIGN[column.align ?? 'left'],
                        column.headerClassName,
                      )}
                      aria-sort={
                        direction
                          ? direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : column.sortField
                            ? 'none'
                            : undefined
                      }
                    >
                      {column.sortField && state ? (
                        <button
                          type="button"
                          onClick={() => cycleSort(column.sortField!)}
                          className={cn(
                            'group/sort -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                            direction && 'text-foreground',
                            column.align === 'right' && 'flex-row-reverse',
                          )}
                        >
                          {column.header}
                          <SortIcon direction={direction} />
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {showSkeleton
                ? Array.from({ length: Math.min(state?.pageSize ?? 8, 8) }, (_, i) => (
                    <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                      {Array.from({ length: colCount }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton
                            className={cn('h-4', j === 0 ? 'w-4/5' : j % 3 === 0 ? 'w-1/3' : 'w-2/3')}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : null}

              {!showSkeleton
                ? rows.map((row, index) => {
                    const id = getRowId(row);
                    const isSelected = selected.has(id);
                    const isExpanded = expanded.has(id);
                    const clickable = !!onRowClick || expandable;
                    return (
                      <Fragment key={id}>
                        <TableRow
                          data-state={isSelected ? 'selected' : undefined}
                          aria-expanded={expandable ? isExpanded : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          className={cn(
                            clickable &&
                              'cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none',
                            isExpanded && 'bg-muted/30 [&>td]:border-b-transparent',
                            rowClassName?.(row),
                          )}
                          onClick={clickable ? () => rowActivate(row) : undefined}
                          onKeyDown={
                            clickable
                              ? (e) => {
                                  if (e.target !== e.currentTarget) return;
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    rowActivate(row);
                                  }
                                }
                              : undefined
                          }
                        >
                          {selectable ? (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isSelected}
                                disabled={isRowSelectable ? !isRowSelectable(row) : false}
                                onCheckedChange={(v) => toggleRow(row, v === true)}
                                aria-label="Select row"
                              />
                            </TableCell>
                          ) : null}
                          {expandable ? (
                            <TableCell className="w-8 pr-0">
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpanded(id);
                                }}
                                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                              >
                                <ChevronRight
                                  className={cn('size-4 transition-transform', isExpanded && 'rotate-90')}
                                />
                              </button>
                            </TableCell>
                          ) : null}
                          {columns.map((column) => (
                            <TableCell
                              key={column.id}
                              className={cn(ALIGN[column.align ?? 'left'], column.className)}
                            >
                              {column.interactive ? (
                                <div
                                  className={cn('inline-flex', column.align === 'right' && 'justify-end')}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  {column.cell(row, index)}
                                </div>
                              ) : (
                                column.cell(row, index)
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                        {expandable && isExpanded ? (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={colCount} className="px-4 pt-0 pb-4">
                              {renderExpanded(row)}
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                : null}
            </TableBody>
          </Table>
        )}

        {/* Rendered outside the (possibly wide, horizontally scrolling) table so it stays visible on phones. */}
        {!showSkeleton && !showError && rows.length === 0 ? (
          <div>
            {emptyState ?? (
              <EmptyState
                icon={Inbox}
                title={state?.hasActiveFilters ? 'No matching results' : 'Nothing here yet'}
                description={
                  state?.hasActiveFilters ? 'Try a different search or clear the filters.' : undefined
                }
                action={
                  state?.hasActiveFilters ? (
                    <Button variant="outline" size="sm" onClick={state.reset}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
                compact
              />
            )}
          </div>
        ) : null}

        {state && total !== undefined && (rows.length > 0 || state.page > 1) ? (
          <DataTablePagination state={state} total={total} />
        ) : null}
      </div>
    </div>
  );
}
