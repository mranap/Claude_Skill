import { api } from '@/lib/api/client';
import type { AuditLogDto, MetaApiLogDto, Paginated, SystemLogDto } from '@/lib/api/types';

type Params = Record<string, string | number | undefined>;

export const adminLogsApi = {
  audit: (params: Params, signal?: AbortSignal) => api.get<Paginated<AuditLogDto>>('/admin/audit', params, { signal }),
  system: (params: Params, signal?: AbortSignal) => api.get<Paginated<SystemLogDto>>('/admin/logs', params, { signal }),
  meta: (params: Params, signal?: AbortSignal) => api.get<Paginated<MetaApiLogDto>>('/admin/meta-api-logs', params, { signal }),
};
