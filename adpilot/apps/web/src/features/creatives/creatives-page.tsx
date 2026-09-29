'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Ellipsis, Eye, Film, ImageIcon, Images, LayoutGrid, List, Upload } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  DataTable,
  DataTablePagination,
  TableSearch,
  useUrlTableState,
  type DataTableColumn,
} from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { useAuth } from '@/features/auth/auth-context';
import { queryKeys } from '@/lib/api/query-keys';
import { useLocalPreference } from '@/lib/hooks/use-local-preference';
import { cn } from '@/lib/utils/cn';
import { replaceQuery } from '@/lib/utils/url';
import { formatBytes, pluralize } from '@/lib/utils/format';
import { creativesApi, useCreativeUsage, useCreatives } from './api';
import { CreativePreviewDialog } from './creative-preview-dialog';
import { CreativeThumb, describeCreative, formatDuration } from './creative-thumb';
import { UploadDropzone, UploadList } from './upload-panel';
import { useUploadQueue, type UploadItem } from './upload-queue';
import type { CreativeDto } from './types';

const SORTS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'originalName:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'durationMs:desc', label: 'Longest videos' },
];

export function CreativesPage() {
  const { can } = useAuth();
  const canManage = can('app.creatives.manage');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const state = useUrlTableState({
    filterKeys: ['type'],
    defaultSort: 'createdAt:desc',
    defaultPageSize: 25,
  });
  const creatives = useCreatives(state.params);
  const usage = useCreativeUsage();
  const [view, changeView] = useLocalPreference<'grid' | 'list'>('adpilot.creatives.view', 'grid', [
    'grid',
    'list',
  ]);
  const [deleting, setDeleting] = useState<CreativeDto | null>(null);
  const openId = searchParams.get('open');

  const onSettled = useCallback(
    (item: UploadItem) => {
      if (item.status === 'done' || item.status === 'duplicate') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.creatives.all });
      }
    },
    [queryClient],
  );
  const { queue, items } = useUploadQueue(onSettled);

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set('open', id);
    else next.delete('open');
    replaceQuery(pathname, next);
  };

  const addFiles = (files: File[]) => {
    const usageData = usage.data;
    queue.add(files, usageData);
    if (files.length > 1) toast.message(`${files.length} files added to the upload queue`);
  };

  const usedBytes = Number(usage.data?.usedBytes ?? 0);
  const quotaBytes = Number(usage.data?.quotaBytes ?? 0);
  const usedPct = quotaBytes ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;
  const hasLibrary = (creatives.data?.total ?? 0) > 0 || state.hasActiveFilters;

  const columns: DataTableColumn<CreativeDto>[] = [
    {
      id: 'thumb',
      header: <span className="sr-only">Preview</span>,
      className: 'w-16',
      cell: (c) => <CreativeThumb creative={c} className="size-12 rounded-md" showBadge={false} />,
    },
    {
      id: 'name',
      header: 'Name',
      sortField: 'originalName',
      cell: (c) => (
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate font-medium">{c.name}</span>
          {c.tags.length ? (
            <span className="flex flex-wrap gap-1">
              {c.tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="secondary" size="sm">
                  {t}
                </Badge>
              ))}
            </span>
          ) : null}
        </div>
      ),
    },
    { id: 'type', header: 'Type', cell: (c) => (c.type === 'VIDEO' ? 'Video' : 'Image') },
    {
      id: 'dims',
      header: 'Dimensions',
      cell: (c) =>
        c.width && c.height ? `${c.width}×${c.height}${c.aspectRatio ? ` · ${c.aspectRatio}` : ''}` : '—',
    },
    {
      id: 'duration',
      header: 'Duration',
      sortField: 'durationMs',
      cell: (c) => (c.type === 'VIDEO' ? formatDuration(c.durationMs) : '—'),
    },
    {
      id: 'size',
      header: 'Size',
      sortField: 'sizeBytes',
      align: 'right',
      cell: (c) => <span className="tabular-nums">{formatBytes(c.sizeBytes)}</span>,
    },
    {
      id: 'created',
      header: 'Uploaded',
      sortField: 'createdAt',
      cell: (c) => <RelativeTime value={c.createdAt} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      interactive: true,
      cell: (c) => (
        <CreativeMenu
          creative={c}
          onOpen={() => setOpen(c.id)}
          onDelete={canManage ? () => setDeleting(c) : undefined}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Creatives"
        description="Your image and video library. Files are validated against Meta's requirements on upload and reused across launches."
        actions={
          canManage ? (
            <Button
              onClick={() =>
                document.querySelector<HTMLInputElement>('[data-testid="creative-file-input"]')?.click()
              }
            >
              <Upload />
              Upload
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4">
        <Card>
          <CardContent className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">Storage</span>
                {usage.data ? (
                  <span className="text-muted-foreground tabular-nums">
                    {formatBytes(usage.data.usedBytes)} of {formatBytes(usage.data.quotaBytes)} used
                  </span>
                ) : (
                  <Skeleton className="h-4 w-32" />
                )}
              </div>
              <Progress
                value={usedPct}
                tone={usedPct > 90 ? 'danger' : usedPct > 75 ? 'warning' : 'default'}
                aria-label="Storage used"
              />
            </div>
            <div className="flex gap-4 text-sm text-muted-foreground sm:pl-4">
              <span className="flex items-center gap-1.5">
                <ImageIcon className="size-4" aria-hidden />
                {pluralize(usage.data?.images ?? 0, 'image')}
              </span>
              <span className="flex items-center gap-1.5">
                <Film className="size-4" aria-hidden />
                {pluralize(usage.data?.videos ?? 0, 'video')}
              </span>
            </div>
          </CardContent>
        </Card>

        {canManage ? <UploadDropzone onFiles={addFiles} usage={usage.data} compact={hasLibrary} /> : null}
        <UploadList items={items} queue={queue} />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <TableSearch state={state} placeholder="Search name or tag" />
            <SegmentedControl
              aria-label="Type"
              size="sm"
              value={(state.filters.type as 'IMAGE' | 'VIDEO' | undefined) ?? 'ALL'}
              onValueChange={(v) => state.setFilter('type', v === 'ALL' ? undefined : v)}
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'IMAGE', label: 'Images' },
                { value: 'VIDEO', label: 'Videos' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={state.sort ?? 'createdAt:desc'} onValueChange={(v) => state.setSort(v)}>
              <SelectTrigger size="sm" className="w-40" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SegmentedControl
              aria-label="View"
              size="sm"
              value={view}
              onValueChange={changeView}
              options={[
                {
                  value: 'grid',
                  label: <span className="sr-only">Grid</span>,
                  icon: <LayoutGrid />,
                  title: 'Grid',
                },
                {
                  value: 'list',
                  label: <span className="sr-only">List</span>,
                  icon: <List />,
                  title: 'List',
                },
              ]}
            />
          </div>
        </div>

        {view === 'list' ? (
          <DataTable
            aria-label="Creatives"
            columns={columns}
            data={creatives.data?.items}
            total={creatives.data?.total}
            state={state}
            getRowId={(c) => c.id}
            isLoading={creatives.isLoading}
            isFetching={creatives.isFetching}
            error={creatives.error}
            onRetry={() => void creatives.refetch()}
            onRowClick={(c) => setOpen(c.id)}
            minWidth={820}
            emptyState={<LibraryEmpty filtered={state.hasActiveFilters} onReset={state.reset} />}
          />
        ) : creatives.isError ? (
          <ErrorAlert error={creatives.error} onRetry={() => void creatives.refetch()} />
        ) : creatives.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
            ))}
          </div>
        ) : creatives.data?.items.length ? (
          <div className={cn('grid gap-4 transition-opacity', creatives.isFetching && 'opacity-70')}>
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              aria-label="Creatives"
            >
              {creatives.data.items.map((c) => (
                <li
                  key={c.id}
                  className="group relative min-w-0 overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-overlay"
                >
                  <button
                    type="button"
                    onClick={() => setOpen(c.id)}
                    className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    aria-label={`Preview ${c.name}`}
                  >
                    <CreativeThumb creative={c} className="aspect-square w-full" />
                    <div className="grid gap-0.5 p-2.5">
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{describeCreative(c)}</span>
                    </div>
                  </button>
                  <div className="absolute top-1.5 right-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    <CreativeMenu
                      creative={c}
                      onOpen={() => setOpen(c.id)}
                      onDelete={canManage ? () => setDeleting(c) : undefined}
                      overlay
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="rounded-lg border bg-card">
              <DataTablePagination state={state} total={creatives.data.total} />
            </div>
          </div>
        ) : (
          <Card>
            <LibraryEmpty filtered={state.hasActiveFilters} onReset={state.reset} />
          </Card>
        )}
      </div>

      <CreativePreviewDialog id={openId} onOpenChange={(open) => !open && setOpen(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="The file is removed from your library and its storage is released. Ads already running at Meta keep their media."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return;
          await creativesApi.remove(deleting.id);
          toast.success('Creative deleted');
          await queryClient.invalidateQueries({ queryKey: queryKeys.creatives.all });
        }}
      />
    </>
  );
}

function CreativeMenu({
  creative,
  onOpen,
  onDelete,
  overlay = false,
}: {
  creative: CreativeDto;
  onOpen: () => void;
  onDelete?: () => void;
  overlay?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={overlay ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={overlay ? 'shadow-sm' : undefined}
          aria-label={`Actions for ${creative.name}`}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onOpen}>
          <Eye />
          Preview & details
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={creative.fileUrl} download={creative.name}>
            <Upload className="rotate-180" />
            Download
          </a>
        </DropdownMenuItem>
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LibraryEmpty({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return filtered ? (
    <EmptyState
      compact
      icon={Images}
      title="No creatives match"
      action={
        <Button variant="outline" size="sm" onClick={onReset}>
          Reset filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={Images}
      title="Your library is empty"
      description="Upload JPG/PNG images and MP4/MOV videos. They can be used in any launch and uploaded to Meta once per ad account."
    />
  );
}
