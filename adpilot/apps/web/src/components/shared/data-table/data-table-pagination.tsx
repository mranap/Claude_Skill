'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNumber } from '@/lib/utils/format';
import { PAGE_SIZE_OPTIONS, type TableController } from './use-table-state';

export function DataTablePagination({ state, total }: { state: TableController; total: number }) {
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  const page = Math.min(state.page, pageCount);
  const from = total === 0 ? 0 : (page - 1) * state.pageSize + 1;
  const to = Math.min(total, page * state.pageSize);

  return (
    <div className="flex flex-col-reverse items-center justify-between gap-3 border-t px-4 py-2.5 text-[13px] text-muted-foreground sm:flex-row">
      <p className="tabular-nums" aria-live="polite">
        {total === 0 ? 'No results' : (
          <>
            <span className="font-medium text-foreground">{formatNumber(from)}–{formatNumber(to)}</span> of{' '}
            <span className="font-medium text-foreground">{formatNumber(total)}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="hidden items-center gap-2 sm:flex">
          <span>Rows per page</span>
          <Select value={String(state.pageSize)} onValueChange={(v) => state.setPageSize(Number(v))}>
            <SelectTrigger size="sm" className="h-7 w-[4.5rem]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="tabular-nums">
          Page {formatNumber(page)} of {formatNumber(pageCount)}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-xs" onClick={() => state.setPage(1)} disabled={page <= 1} aria-label="First page" className="hidden sm:inline-flex">
            <ChevronsLeft />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={() => state.setPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={() => state.setPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <ChevronRight />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={() => state.setPage(pageCount)} disabled={page >= pageCount} aria-label="Last page" className="hidden sm:inline-flex">
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
