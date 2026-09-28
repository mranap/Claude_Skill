'use client';

import type { TemplateConfig, templateCreateSchema, templateUpdateSchema } from '@adpilot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { ISODateString, Paginated } from '@/lib/api/types';

export interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  objective: string;
  objectiveLabel: string;
  destination?: string;
  optimizationGoal?: string;
  budget?: { level?: 'CAMPAIGN' | 'ADSET'; type?: 'DAILY' | 'LIFETIME'; amount?: string; bidStrategy?: string };
  countries: string[];
  variantsCount: number;
  isArchived: boolean;
  lastUsedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TemplateDetail {
  id: string;
  name: string;
  description: string | null;
  objective: string;
  schemaVersion: number;
  config: TemplateConfig;
  isArchived: boolean;
  clonedFromId: string | null;
  lastUsedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const templatesApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) => api.get<Paginated<TemplateListItem>>('/templates', params, { signal }),
  get: (id: string) => api.get<TemplateDetail>(`/templates/${id}`),
  create: (body: z.input<typeof templateCreateSchema>) => api.post<TemplateDetail>('/templates', body),
  update: (id: string, body: z.input<typeof templateUpdateSchema>) => api.patch<TemplateDetail>(`/templates/${id}`, body),
  clone: (id: string) => api.post<TemplateDetail>(`/templates/${id}/clone`),
  remove: (id: string) => api.delete<{ archived: boolean; deleted: boolean }>(`/templates/${id}`),
};

export function useTemplates(params: Record<string, string | number>, enabled = true) {
  return useQuery({
    queryKey: queryKeys.templates.list(params),
    queryFn: ({ signal }) => templatesApi.list(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTemplate(id: string | null | undefined) {
  return useQuery({ queryKey: queryKeys.templates.detail(id ?? ''), queryFn: () => templatesApi.get(id as string), enabled: !!id });
}
