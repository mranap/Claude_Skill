'use client';

import type { adAccountUpdateSchema } from '@adpilot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { Paginated } from '@/lib/api/types';
import type { ActivityEventDto } from '../activity/types';
import type { PageDto } from '../meta-profiles/types';
import type { AdAccountDetailDto, AdAccountDto, AudienceDto, PixelDto, StatusHistoryDto } from './types';

export const adAccountsApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) => api.get<Paginated<AdAccountDto>>('/ad-accounts', params, { signal }),
  get: (id: string) => api.get<AdAccountDetailDto>(`/ad-accounts/${id}`),
  update: (id: string, body: z.input<typeof adAccountUpdateSchema>) => api.patch<AdAccountDetailDto>(`/ad-accounts/${id}`, body),
  connect: (body: { profileId: string; connect: string[]; disconnect: string[] }) =>
    api.post<{ connected: number; disconnected: number }>('/ad-accounts/connect', body),
  checkStatus: (id: string) => api.post<{ queued: boolean }>(`/ad-accounts/${id}/check-status`),
  statusHistory: (id: string) => api.get<StatusHistoryDto[]>(`/ad-accounts/${id}/status-history`),
  pixels: (id: string) => api.get<PixelDto[]>(`/ad-accounts/${id}/pixels`),
  audiences: (id: string) => api.get<AudienceDto[]>(`/ad-accounts/${id}/audiences`),
  pages: (id: string) => api.get<PageDto[]>(`/ad-accounts/${id}/pages`),
  activity: (id: string, params: Record<string, string | number>) => api.get<Paginated<ActivityEventDto>>(`/ad-accounts/${id}/activity`, params),
};

export function useAdAccounts(params: Record<string, string | number>) {
  return useQuery({
    queryKey: queryKeys.adAccounts.list(params),
    queryFn: ({ signal }) => adAccountsApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

/** Every connected ad account (selectors, filters). */
export function useConnectedAdAccounts(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adAccounts.lookup,
    queryFn: ({ signal }) => adAccountsApi.list({ connected: 'true', pageSize: 200, sort: 'name:asc' }, signal).then((r) => r.items),
    staleTime: 60_000,
    enabled,
  });
}

export function useAdAccount(id: string | null | undefined, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.adAccounts.detail(id ?? ''),
    queryFn: () => adAccountsApi.get(id as string),
    enabled: !!id,
    refetchInterval: options.poll ? 5000 : false,
  });
}

export function usePixels(adAccountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.adAccounts.pixels(adAccountId ?? ''),
    queryFn: () => adAccountsApi.pixels(adAccountId as string),
    enabled: !!adAccountId,
    staleTime: 60_000,
  });
}

export function useAudiences(adAccountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.adAccounts.audiences(adAccountId ?? ''),
    queryFn: () => adAccountsApi.audiences(adAccountId as string),
    enabled: !!adAccountId,
    staleTime: 60_000,
  });
}

export function useAccountPages(adAccountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.adAccounts.pages(adAccountId ?? ''),
    queryFn: () => adAccountsApi.pages(adAccountId as string),
    enabled: !!adAccountId,
    staleTime: 60_000,
  });
}
