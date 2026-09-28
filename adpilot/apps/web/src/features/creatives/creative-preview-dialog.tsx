'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorAlert } from '@/components/shared/error-alert';
import { KeyValueList } from '@/components/shared/key-value';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { formatBytes, formatDateTime } from '@/lib/utils/format';
import { creativesApi, useCreative } from './api';
import { formatDuration } from './creative-thumb';
import type { CreativeDto } from './types';

/** Full preview (image or streamed video) with details, rename, tags and delete. */
export function CreativePreviewDialog({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="overflow-hidden p-0">
        {id ? <PreviewBody id={id} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ id, onClose }: { id: string; onClose: () => void }) {
  const creative = useCreative(id);
  if (creative.isLoading) {
    return (
      <div className="grid gap-4 p-6">
        <DialogTitle className="sr-only">Loading creative</DialogTitle>
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (creative.isError || !creative.data) {
    return (
      <div className="p-6">
        <DialogTitle className="mb-4">Creative</DialogTitle>
        <ErrorAlert error={creative.error} />
      </div>
    );
  }
  return <Preview creative={creative.data} onClose={onClose} />;
}

function Preview({ creative, onClose }: { creative: CreativeDto; onClose: () => void }) {
  const { can } = useAuth();
  const canManage = can('app.creatives.manage');
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(creative.name);
  const [tag, setTag] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const update = useMutation({
    mutationFn: (body: { originalName?: string; tags?: string[] }) => creativesApi.update(creative.id, body),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.creatives.detail(creative.id), (prev: CreativeDto | undefined) =>
        prev ? { ...prev, ...updated, metaAssets: prev.metaAssets } : updated,
      );
      setRenaming(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.creatives.all, refetchType: 'active' });
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const addTag = () => {
    const value = tag.trim().slice(0, 50);
    if (!value || creative.tags.includes(value)) return setTag('');
    update.mutate({ tags: [...creative.tags, value] });
    setTag('');
  };

  return (
    <div className="grid max-h-[calc(100dvh-2rem)] min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden">
      <div className="flex min-h-64 items-center justify-center bg-black/90 lg:min-h-[32rem]">
        {creative.type === 'VIDEO' ? (
          <video
            key={creative.id}
            src={creative.fileUrl}
            controls
            preload="metadata"
            poster={creative.previewUrl ?? undefined}
            className="max-h-[70dvh] w-full object-contain"
          >
            <track kind="captions" />
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated API media
          <img src={creative.fileUrl} alt={creative.name} className="max-h-[70dvh] w-full object-contain" />
        )}
      </div>
      <div className="grid min-h-0 content-start gap-4 overflow-y-auto p-5">
        <DialogHeader className="p-0 pr-8">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== creative.name)
                  update.mutate({ originalName: name.trim() });
                else setRenaming(false);
              }}
            >
              <DialogTitle className="sr-only">Rename {creative.name}</DialogTitle>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoFocus
                aria-label="File name"
                className="h-8"
              />
              <Button type="submit" size="sm" loading={update.isPending}>
                Save
              </Button>
            </form>
          ) : (
            <div className="flex items-start gap-2">
              <DialogTitle className="min-w-0 break-words">{creative.name}</DialogTitle>
              {canManage ? (
                <Button variant="ghost" size="icon-xs" onClick={() => setRenaming(true)} aria-label="Rename">
                  <Pencil />
                </Button>
              ) : null}
            </div>
          )}
          <DialogDescription>
            {creative.type === 'VIDEO' ? 'Video' : 'Image'} · uploaded {formatDateTime(creative.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <KeyValueList
          items={[
            { label: 'Format', value: `${creative.extension.toUpperCase()} · ${creative.mimeType}` },
            {
              label: 'Dimensions',
              value: creative.width && creative.height ? `${creative.width} × ${creative.height} px` : null,
            },
            { label: 'Aspect ratio', value: creative.aspectRatio },
            {
              label: 'Duration',
              value: creative.durationMs ? formatDuration(creative.durationMs) : null,
              hidden: creative.type !== 'VIDEO',
            },
            {
              label: 'Codecs',
              value: [creative.videoCodec, creative.audioCodec].filter(Boolean).join(' / ') || null,
              hidden: creative.type !== 'VIDEO',
            },
            {
              label: 'Frame rate',
              value: creative.frameRate ? `${creative.frameRate} fps` : null,
              hidden: creative.type !== 'VIDEO',
            },
            { label: 'Size', value: formatBytes(creative.sizeBytes) },
            { label: 'Status', value: <StatusBadge status={creative.status} size="sm" /> },
          ]}
        />
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {creative.tags.map((t) => (
              <Badge key={t} variant="secondary" className="gap-0.5 pr-0.5">
                {t}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => update.mutate({ tags: creative.tags.filter((x) => x !== t) })}
                    className="flex size-4 items-center justify-center rounded hover:bg-background/60"
                    aria-label={`Remove tag ${t}`}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </Badge>
            ))}
            {!creative.tags.length ? <span className="text-sm text-muted-foreground">No tags</span> : null}
          </div>
          {canManage && creative.tags.length < 20 ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addTag();
              }}
            >
              <Input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="Add a tag"
                maxLength={50}
                className="h-8"
                aria-label="New tag"
              />
              <Button type="submit" variant="outline" size="sm" disabled={!tag.trim()}>
                <Plus />
                Add
              </Button>
            </form>
          ) : null}
        </div>
        {creative.metaAssets.length ? (
          <div className="grid gap-2">
            <p className="text-xs font-medium text-muted-foreground">Uploaded to Meta</p>
            <ul className="grid gap-1.5">
              {creative.metaAssets.map((a) => (
                <li key={a.adAccountId} className="grid gap-0.5 text-sm">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{a.adAccountName ?? a.adAccountId}</span>
                    <StatusBadge status={a.status} size="sm" />
                  </span>
                  {a.error ? <span className="text-xs text-destructive-fg">{a.error}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" size="sm" asChild>
            <a href={creative.fileUrl} download={creative.name}>
              <Download />
              Download
            </a>
          </Button>
          {canManage ? (
            <Button variant="destructive-outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              Delete
            </Button>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={`Delete “${creative.name}”?`}
        description="The file is removed from your library and its storage is released. Ads already running at Meta keep their media."
        confirmLabel="Delete"
        onConfirm={async () => {
          await creativesApi.remove(creative.id);
          toast.success('Creative deleted');
          await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.creatives.all })]);
          onClose();
        }}
      />
    </div>
  );
}
