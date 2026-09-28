'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { Paginated } from '@/lib/api/types';
import type {
  BudgetChangeResult,
  BulkOperationDto,
  CampaignDetail,
  CampaignListItem,
  EntityActionLevel,
  StatusChangeResult,
} from './types';

export interface BudgetChangeBody {
  level: 'CAMPAIGN' | 'ADSET';
  id: string;
  mode: 'SET' | 'INCREASE_PCT' | 'DECREASE_PCT';
  /** Major units for SET, percent for INCREASE/DECREASE. */
  value: string;
  confirmLargeChange?: boolean;
}

export const campaignsApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) => api.get<Paginated<CampaignListItem>>('/campaigns', params, { signal }),
  get: (id: string, params: Record<string, string>, signal?: AbortSignal) => api.get<CampaignDetail>(`/campaigns/${id}`, params, { signal }),
  setStatus: (body: { level: EntityActionLevel; id: string; status: 'ACTIVE' | 'PAUSED' }) =>
    api.post<StatusChangeResult>('/campaigns/actions/status', body),
  /** The Idempotency-Key makes a retried request (timeout, double submit) return the first outcome. */
  changeBudget: (body: BudgetChangeBody, idempotencyKey: string) =>
    api.post<BudgetChangeResult>('/campaigns/actions/budget', body, { headers: { 'Idempotency-Key': idempotencyKey } }),
  bulkStatus: (body: { level: EntityActionLevel; ids: string[]; status: 'ACTIVE' | 'PAUSED'; idempotencyKey: string; confirmed: true }) =>
    api.post<BulkOperationDto>('/campaigns/actions/bulk-status', body),
  bulk: (id: string) => api.get<BulkOperationDto>(`/campaigns/bulk/${id}`),
};

export function isBulkDone(op: Pick<BulkOperationDto, 'status'> | undefined): boolean {
  return op?.status === 'SUCCESS' || op?.status === 'FAILED';
}

export function useCampaigns(params: Record<string, string | number>, enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaigns.list(params),
    queryFn: ({ signal }) => campaignsApi.list(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCampaign(id: string | null | undefined, params: Record<string, string>) {
  return useQuery({
    queryKey: queryKeys.campaigns.detail(id ?? '', params),
    queryFn: ({ signal }) => campaignsApi.get(id as string, params, signal),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

/** Polls a bulk operation every 1.5 s until it succeeds or fails. */
export function useBulkOperation(id: string | null, initial?: BulkOperationDto) {
  return useQuery({
    queryKey: queryKeys.campaigns.bulk(id ?? ''),
    queryFn: () => campaignsApi.bulk(id as string),
    enabled: !!id,
    initialData: initial && initial.id === id ? initial : undefined,
    refetchInterval: (query) => (isBulkDone(query.state.data) ? false : 1500),
  });
}
