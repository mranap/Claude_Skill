'use client';

import type { ruleCreateSchema } from '@adpilot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { OkResponse, Paginated } from '@/lib/api/types';
import type { RuleDto, RuleExecutionDto } from './types';

export type RuleInput = z.output<typeof ruleCreateSchema>;

export const rulesApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) => api.get<Paginated<RuleDto>>('/rules', params, { signal }),
  get: (id: string) => api.get<RuleDto>(`/rules/${id}`),
  create: (body: RuleInput) => api.post<RuleDto>('/rules', body),
  update: (id: string, body: RuleInput) => api.put<RuleDto>(`/rules/${id}`, body),
  activate: (id: string) => api.post<RuleDto>(`/rules/${id}/activate`),
  deactivate: (id: string) => api.post<RuleDto>(`/rules/${id}/deactivate`),
  run: (id: string) => api.post<{ queued: boolean }>(`/rules/${id}/run`),
  remove: (id: string) => api.delete<OkResponse>(`/rules/${id}`),
  executions: (params: Record<string, string | number>, signal?: AbortSignal) =>
    api.get<Paginated<RuleExecutionDto>>('/rules/executions', params, { signal }),
};

export function useRules(params: Record<string, string | number>) {
  return useQuery({
    queryKey: queryKeys.rules.list(params),
    queryFn: ({ signal }) => rulesApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useRule(id: string | null | undefined) {
  return useQuery({ queryKey: queryKeys.rules.detail(id ?? ''), queryFn: () => rulesApi.get(id as string), enabled: !!id });
}

export function useRuleExecutions(params: Record<string, string | number>, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.rules.executions(params),
    queryFn: ({ signal }) => rulesApi.executions(params, signal),
    placeholderData: keepPreviousData,
    refetchInterval: options.poll ? 10_000 : false,
  });
}
