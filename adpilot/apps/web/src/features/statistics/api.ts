'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { StatsRefreshResponse, StatsTableResponse } from './types';

export const statisticsApi = {
  table: (params: Record<string, string | number>, signal?: AbortSignal) =>
    api.get<StatsTableResponse>('/statistics', params, { signal }),
  refresh: (adAccountId?: string) =>
    api.post<StatsRefreshResponse>('/statistics/refresh', adAccountId ? { adAccountId } : {}),
};

export function useStatistics(
  params: Record<string, string | number>,
  options: { enabled?: boolean; poll?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.statistics.table(params),
    queryFn: ({ signal }) => statisticsApi.table(params, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    // While a sync is queued or running, keep the table fresh so new numbers appear without a reload.
    refetchInterval: (query) => {
      if (!options.poll) return false;
      const busy = query.state.data?.sync.some((s) => s.status === 'QUEUED' || s.status === 'RUNNING');
      return busy ? 5000 : false;
    },
  });
}
