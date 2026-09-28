'use client';

import type {
  metaConnectionTestSchema,
  metaProfileCreateSchema,
  metaProfileUpdateSchema,
  ProxyTestResult,
  TokenInspection,
} from '@adpilot/shared';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { OkResponse } from '@/lib/api/types';
import type { ConnectionTestResponse, MetaProfileDto, ProfileAssets, ProfileSaveResponse } from './types';

export const metaProfilesApi = {
  list: () => api.get<MetaProfileDto[]>('/meta-profiles'),
  get: (id: string) => api.get<MetaProfileDto>(`/meta-profiles/${id}`),
  create: (body: z.input<typeof metaProfileCreateSchema>) => api.post<ProfileSaveResponse>('/meta-profiles', body),
  update: (id: string, body: z.input<typeof metaProfileUpdateSchema>) => api.patch<ProfileSaveResponse>(`/meta-profiles/${id}`, body),
  remove: (id: string) => api.delete<OkResponse>(`/meta-profiles/${id}`),
  /** Tests a token and/or proxy before saving — nothing is stored. */
  test: (body: z.input<typeof metaConnectionTestSchema>) => api.post<ConnectionTestResponse>('/meta-profiles/test', body),
  validate: (id: string) => api.post<TokenInspection>(`/meta-profiles/${id}/validate`),
  testProxy: (id: string) => api.post<ProxyTestResult>(`/meta-profiles/${id}/test-proxy`),
  sync: (id: string) => api.post<{ queued: boolean }>(`/meta-profiles/${id}/sync`),
  assets: (id: string) => api.get<ProfileAssets>(`/meta-profiles/${id}/assets`),
};

/** True while an asset sync is queued or running (the UI polls until it settles). */
export function isSyncing(profile: Pick<MetaProfileDto, 'syncStatus'> | undefined): boolean {
  return profile?.syncStatus === 'QUEUED' || profile?.syncStatus === 'RUNNING';
}

export function useMetaProfiles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.metaProfiles.list,
    queryFn: metaProfilesApi.list,
    enabled,
    refetchInterval: (query) => (query.state.data?.some((p) => isSyncing(p)) ? 3000 : false),
  });
}

export function useMetaProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.metaProfiles.detail(id),
    queryFn: () => metaProfilesApi.get(id),
    refetchInterval: (query) => (isSyncing(query.state.data) ? 3000 : false),
  });
}

export function useProfileAssets(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.metaProfiles.assets(id ?? ''),
    queryFn: () => metaProfilesApi.assets(id as string),
    enabled: !!id && enabled,
  });
}
