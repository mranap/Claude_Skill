'use client';

import type { MetaProfileStatus, UserStatus } from '@adpilot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { BigIntString, ISODateString, JobRunStatus, OkResponse, Paginated } from '@/lib/api/types';

export const JOB_STATES = [
  'failed',
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'paused',
  'completed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface QueueSummary {
  name: string;
  paused: boolean;
  counts: Record<JobState, number>;
}

/** GET /admin/dashboard */
export interface AdminDashboardDto {
  users: Partial<Record<UserStatus, number>>;
  metaProfiles: Partial<Record<MetaProfileStatus, number>>;
  adAccounts: { total: number; connected: number };
  campaigns: number;
  files: { count: number; bytes: BigIntString };
  launches24h: { total: number; failed: number };
  metaApi24h: { errors: number; rateLimited: number };
  /** System log entries with level ERROR. */
  workerErrors24h: number;
  queues: QueueSummary[];
}

export interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error' | 'disabled';
  detail: string;
  latencyMs?: number;
}

export interface QueueJob {
  id: string;
  name: string;
  /** Sanitised payload (message bodies replaced by their size). */
  data: unknown;
  attemptsMade: number;
  maxAttempts?: number;
  failedReason?: string;
  stacktrace: string[];
  /** Epoch milliseconds. */
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  delay?: number;
}

export interface WorkerHeartbeat {
  id: string;
  host: string;
  pid: number;
  queues: { name: string; concurrency: number; running: boolean }[];
  processed?: number;
  failed?: number;
  startedAt?: ISODateString;
  memoryMb?: number;
  at: ISODateString;
}

export interface WorkersResponse {
  workers: WorkerHeartbeat[];
  scheduler: { host: string; pid: number; at: ISODateString; tasks: string[] } | null;
}

/** One Meta usage scope (app, business use case or ad account) tracked by the rate limiter. */
export interface RateLimitScope {
  key: string;
  state: { pct: number; blockedUntil: number; at: number };
  /** acct | buc | tok | app | obj */
  scope?: string;
  /** Human readable scope (ad account / profile names), provided by the API. */
  label?: string;
}

export interface StorageStats {
  bucket: string;
  check: { ok: boolean; detail: string };
  byType: { type: 'IMAGE' | 'VIDEO' | string; count: number; bytes: BigIntString }[];
  topUsers: {
    id: string;
    email: string;
    storageUsedBytes: BigIntString;
    storageQuotaBytes: BigIntString | null;
  }[];
}

export interface BackupDto {
  id: string;
  kind: string;
  status: JobRunStatus;
  storageKey: string | null;
  sizeBytes: BigIntString | null;
  error: string | null;
  triggeredById: string | null;
  startedAt: ISODateString;
  finishedAt: ISODateString | null;
}

export const adminOpsApi = {
  dashboard: () => api.get<AdminDashboardDto>('/admin/dashboard'),
  health: (deep: boolean) => api.get<HealthCheck[]>('/admin/health', deep ? { deep: 'true' } : undefined),
  queues: () => api.get<QueueSummary[]>('/admin/queues'),
  jobs: (name: string, params: { state: JobState; page: number; pageSize: number }) =>
    api.get<Paginated<QueueJob>>(`/admin/queues/${encodeURIComponent(name)}/jobs`, params),
  retryJob: (name: string, id: string) =>
    api.post<OkResponse>(`/admin/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(id)}/retry`),
  removeJob: (name: string, id: string) =>
    api.delete<OkResponse>(`/admin/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(id)}`),
  pause: (name: string) => api.post<OkResponse>(`/admin/queues/${encodeURIComponent(name)}/pause`),
  resume: (name: string) => api.post<OkResponse>(`/admin/queues/${encodeURIComponent(name)}/resume`),
  clean: (name: string, body: { state: 'completed' | 'failed'; olderThanHours: number }) =>
    api.post<{ removed: number }>(`/admin/queues/${encodeURIComponent(name)}/clean`, body),
  workers: () => api.get<WorkersResponse>('/admin/workers'),
  rateLimits: () => api.get<RateLimitScope[]>('/admin/meta-rate-limits'),
  storage: () => api.get<StorageStats>('/admin/storage'),
  backups: () => api.get<BackupDto[]>('/admin/backups'),
  backupNow: () => api.post<{ id: string }>('/admin/backups'),
  retentionNow: () => api.post<{ queued: boolean }>('/admin/maintenance/retention'),
};

export const opsKeys = {
  all: ['admin', 'ops'] as const,
  dashboard: ['admin', 'ops', 'dashboard'] as const,
  health: (deep: boolean) => ['admin', 'ops', 'health', deep] as const,
  queues: ['admin', 'ops', 'queues'] as const,
  jobs: (name: string, params: Record<string, unknown>) => ['admin', 'ops', 'jobs', name, params] as const,
  workers: ['admin', 'ops', 'workers'] as const,
  rateLimits: ['admin', 'ops', 'rate-limits'] as const,
  storage: ['admin', 'ops', 'storage'] as const,
  backups: ['admin', 'ops', 'backups'] as const,
};

export function useAdminDashboard(enabled = true) {
  return useQuery({
    queryKey: opsKeys.dashboard,
    queryFn: adminOpsApi.dashboard,
    enabled,
    refetchInterval: 30_000,
  });
}

export function useHealth(enabled = true) {
  return useQuery({
    queryKey: opsKeys.health(false),
    queryFn: () => adminOpsApi.health(false),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useQueues(enabled = true) {
  return useQuery({ queryKey: opsKeys.queues, queryFn: adminOpsApi.queues, enabled, refetchInterval: 5000 });
}

export function useQueueJobs(
  name: string | null,
  params: { state: JobState; page: number; pageSize: number },
) {
  return useQuery({
    queryKey: opsKeys.jobs(name ?? '', params),
    queryFn: () => adminOpsApi.jobs(name as string, params),
    enabled: !!name,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
}

export function useWorkers(enabled = true) {
  return useQuery({
    queryKey: opsKeys.workers,
    queryFn: adminOpsApi.workers,
    enabled,
    refetchInterval: 10_000,
  });
}

export function useRateLimits(enabled = true) {
  return useQuery({
    queryKey: opsKeys.rateLimits,
    queryFn: adminOpsApi.rateLimits,
    enabled,
    refetchInterval: 10_000,
  });
}

export function useStorageStats(enabled = true) {
  return useQuery({ queryKey: opsKeys.storage, queryFn: adminOpsApi.storage, enabled, staleTime: 30_000 });
}

export function useBackups(enabled = true) {
  return useQuery({
    queryKey: opsKeys.backups,
    queryFn: adminOpsApi.backups,
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((b) => b.status === 'QUEUED' || b.status === 'RUNNING') ? 3000 : false,
  });
}
