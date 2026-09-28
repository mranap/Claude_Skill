'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/** GET /system/status (public): maintenance mode and the platform name. */
export interface SystemStatus {
  maintenance: { enabled: boolean; message: string | null };
  platformName: string;
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: ({ signal }) => api.get<SystemStatus>('/system/status', undefined, { signal, auth: false }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
}
