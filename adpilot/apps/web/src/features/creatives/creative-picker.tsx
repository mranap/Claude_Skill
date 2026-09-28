'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, Film, ImageIcon, Images, Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { useAuth } from '@/features/auth/auth-context';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils/cn';
import { useCreative, useCreativeUsage, useCreatives } from './api';
import { CreativeThumb, describeCreative } from './creative-thumb';
import { UploadDropzone, UploadList } from './upload-panel';
import { useUploadQueue, type UploadItem } from './upload-queue';

/** Button showing the chosen creative; opens the library picker. */
export function CreativeField({
  value,
  onChange,
  type,
  id,
  invalid,
  disabled,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  type: 'IMAGE' | 'VIDEO';
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const creative = useCreative(value);
  const wrongType = creative.data && creative.data.type !== type;
  return (
    <>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-invalid={invalid || !!wrongType || undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border border-input bg-field p-2 text-left outline-none transition-colors',
          'hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive/70',
        )}
      >
        {value && creative.data ? (
          <>
            <CreativeThumb creative={creative.data} className="size-14 shrink-0 rounded-md" />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-medium">{creative.data.name}</span>
              <span className="truncate text-xs text-muted-foreground">{describeCreative(creative.data)}</span>
              {wrongType ? <span className="text-xs text-destructive-fg">This format needs {type === 'VIDEO' ? 'a video' : 'an image'}.</span> : null}
            </span>
            <span className="ml-auto shrink-0 text-xs font-medium text-primary-fg">Change</span>
          </>
        ) : value && creative.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <>
            <span className="flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground">
              {type === 'VIDEO' ? <Film className="size-5" /> : <ImageIcon className="size-5" />}
            </span>
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">Choose {type === 'VIDEO' ? 'a video' : 'an image'}</span>
              <span className="text-xs text-muted-foreground">From your library or upload a new file</span>
            </span>
          </>
        )}
      </button>
      <CreativePickerDialog
        open={open}
        onOpenChange={setOpen}
        type={type}
        selected={value}
        onSelect={(picked) => {
          onChange(picked);
          setOpen(false);
        }}
      />
    </>
  );
}

export function CreativePickerDialog({
  open,
  onOpenChange,
  type,
  selected,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'IMAGE' | 'VIDEO';
  selected?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">{open ? <PickerBody type={type} selected={selected} onSelect={onSelect} onCancel={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function PickerBody({ type, selected, onSelect, onCancel }: { type: 'IMAGE' | 'VIDEO'; selected?: string; onSelect: (id: string) => void; onCancel: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | undefined>(selected);
  const q = useDebouncedValue(query.trim(), 300);
  const params: Record<string, string | number> = { type, pageSize: 48, sort: 'createdAt:desc', ...(q ? { q } : {}) };
  const creatives = useCreatives(params);
  const usage = useCreativeUsage();
  const onSettled = useCallback(
    (item: UploadItem) => {
      if (item.status === 'done' || item.status === 'duplicate') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.creatives.all });
        if (item.result && item.result.type === type) setPicked(item.result.id);
      }
    },
    [queryClient, type],
  );
  const { queue, items } = useUploadQueue(onSettled);
  const Icon = type === 'VIDEO' ? Film : ImageIcon;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose {type === 'VIDEO' ? 'a video' : 'an image'}</DialogTitle>
        <DialogDescription>Pick from your library or upload new files. Uploaded files are added to the library.</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or tag" className="h-9 pl-8" aria-label="Search creatives" />
        </div>
        {can('app.creatives.manage') ? <UploadDropzone onFiles={(files) => queue.add(files, usage.data)} usage={usage.data} compact /> : null}
        <UploadList items={items} queue={queue} />
        {creatives.isError ? (
          <ErrorAlert error={creatives.error} onRetry={() => void creatives.refetch()} />
        ) : creatives.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : creatives.data?.items.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label="Library">
            {creatives.data.items.map((c) => {
              const active = picked === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(c.id)}
                    onDoubleClick={() => onSelect(c.id)}
                    aria-pressed={active}
                    className={cn(
                      'relative block w-full overflow-hidden rounded-lg border bg-card text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60',
                      active && 'border-primary ring-2 ring-primary/40',
                    )}
                  >
                    <CreativeThumb creative={c} className="aspect-square w-full" />
                    <span className="grid gap-0.5 p-2">
                      <span className="truncate text-xs font-medium">{c.name}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{describeCreative(c)}</span>
                    </span>
                    {active ? (
                      <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check className="size-3.5" />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={q ? Images : Icon} title={q ? 'Nothing matches your search' : `No ${type === 'VIDEO' ? 'videos' : 'images'} in your library`} description={q ? undefined : 'Upload a file above to use it in this ad.'} />
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => picked && onSelect(picked)} disabled={!picked}>
          Use selected
        </Button>
      </DialogFooter>
    </>
  );
}
