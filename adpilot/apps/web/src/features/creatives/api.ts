'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { OkResponse, Paginated } from '@/lib/api/types';
import { uploadWithProgress, type UploadHandlers } from '@/lib/api/upload';
import type { CreativeDto, CreativeUsage, UploadItemResult } from './types';

export const creativesApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) =>
    api.get<Paginated<CreativeDto>>('/creatives', params, { signal }),
  usage: () => api.get<CreativeUsage>('/creatives/usage'),
  get: (id: string) => api.get<CreativeDto>(`/creatives/${id}`),
  update: (id: string, body: { originalName?: string; tags?: string[] }) =>
    api.patch<CreativeDto>(`/creatives/${id}`, body),
  remove: (id: string) => api.delete<OkResponse>(`/creatives/${id}`),
  metaUpload: (id: string, adAccountId: string) =>
    api.post<{ status: string }>(`/creatives/${id}/meta-upload`, { adAccountId }),
  /** One file per request so every file has its own progress, result and retry. */
  upload: (file: File, handlers: UploadHandlers) => {
    const body = new FormData();
    body.append('files', file, file.name);
    return uploadWithProgress<{ results: UploadItemResult[] }>('/creatives/upload', body, handlers);
  },
};

export function useCreatives(params: Record<string, string | number>, enabled = true) {
  return useQuery({
    queryKey: queryKeys.creatives.list(params),
    queryFn: ({ signal }) => creativesApi.list(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCreativeUsage() {
  return useQuery({ queryKey: queryKeys.creatives.usage, queryFn: creativesApi.usage, staleTime: 30_000 });
}

export function useCreative(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.creatives.detail(id ?? ''),
    queryFn: () => creativesApi.get(id as string),
    enabled: !!id,
  });
}
