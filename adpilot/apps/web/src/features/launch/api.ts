'use client';

import { LAUNCH_JOB_TERMINAL_STATUSES, type LaunchJobStatus } from '@adpilot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { OkResponse, Paginated } from '@/lib/api/types';
import type { DraftListItem, DryRunResult, LaunchDraftDto, LaunchJobDto, LaunchJobListItem, ValidationResult } from './types';

export interface DraftSaveBody {
  name: string;
  templateId?: string | null;
  profileId?: string | null;
  adAccountId?: string | null;
  config: Record<string, unknown>;
}

export const draftsApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) => api.get<Paginated<DraftListItem>>('/drafts', params, { signal }),
  get: (id: string) => api.get<LaunchDraftDto>(`/drafts/${id}`),
  create: (body: DraftSaveBody) => api.post<LaunchDraftDto>('/drafts', body),
  fromTemplate: (templateId: string) => api.post<LaunchDraftDto>(`/drafts/from-template/${templateId}`),
  update: (id: string, body: DraftSaveBody, signal?: AbortSignal) => api.put<LaunchDraftDto>(`/drafts/${id}`, body, { signal }),
  clone: (id: string) => api.post<LaunchDraftDto>(`/drafts/${id}/clone`),
  archive: (id: string) => api.delete<OkResponse>(`/drafts/${id}`),
};

export const launchesApi = {
  validate: (config: unknown, draftId?: string) => api.post<ValidationResult>('/launches/validate', { config, draftId }),
  dryRun: (config: unknown) => api.post<DryRunResult>('/launches/dry-run', { config }),
  launch: (body: { idempotencyKey: string; draftId?: string; config: unknown }) => api.post<{ job: LaunchJobDto; duplicate: boolean }>('/launches', body),
  list: (params: Record<string, string | number>, signal?: AbortSignal) => api.get<Paginated<LaunchJobListItem>>('/launches', params, { signal }),
  get: (id: string) => api.get<LaunchJobDto>(`/launches/${id}`),
  cancel: (id: string) => api.post<OkResponse>(`/launches/${id}/cancel`),
  retry: (id: string) => api.post<LaunchJobDto>(`/launches/${id}/retry`),
};

export function isTerminal(status: LaunchJobStatus | string | undefined): boolean {
  return !!status && (LAUNCH_JOB_TERMINAL_STATUSES as string[]).includes(status);
}

export function useDrafts(params: Record<string, string | number>, enabled = true) {
  return useQuery({
    queryKey: queryKeys.drafts.list(params),
    queryFn: ({ signal }) => draftsApi.list(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDraft(id: string) {
  return useQuery({ queryKey: queryKeys.drafts.detail(id), queryFn: () => draftsApi.get(id), staleTime: Infinity, refetchOnWindowFocus: false });
}

export function useLaunchJobs(params: Record<string, string | number>, enabled = true) {
  return useQuery({
    queryKey: queryKeys.launches.list(params),
    queryFn: ({ signal }) => launchesApi.list(params, signal),
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: (query) => (query.state.data?.items.some((j) => !isTerminal(j.status)) ? 3000 : false),
  });
}

/** Polls every 2.5 s until the launch reaches a terminal status. */
export function useLaunchJob(id: string) {
  return useQuery({
    queryKey: queryKeys.launches.detail(id),
    queryFn: () => launchesApi.get(id),
    refetchInterval: (query) => (query.state.data && isTerminal(query.state.data.status) ? false : 2500),
    refetchIntervalInBackground: false,
  });
}
