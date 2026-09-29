'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';

/** GET /ad-accounts/:id/targeting/interests item (Meta Targeting Search, type=adinterest). */
export interface InterestHit {
  id: string;
  name: string;
  /** Category path, e.g. ["Interests", "Business and industry", "Marketing"]. */
  path: string[];
  audienceSizeLower: number | null;
  audienceSizeUpper: number | null;
}

/** GET /ad-accounts/:id/targeting/locales item (Meta locale key + language name). */
export interface LocaleHit {
  key: number;
  name: string;
}

/** GET /ad-accounts/:id/pages/:metaPageId/lead-forms item. Only ACTIVE forms can be used in ads. */
export interface LeadFormDto {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | string;
  locale: string | null;
}

export const INTEREST_MIN_QUERY = 2;

export const targetingApi = {
  interests: (adAccountId: string, q: string, signal?: AbortSignal) =>
    api
      .get<{ items: InterestHit[] }>(`/ad-accounts/${adAccountId}/targeting/interests`, { q }, { signal })
      .then((r) => r.items),
  /** Every targetable language: loaded once per ad account and filtered in the browser. */
  locales: (adAccountId: string, signal?: AbortSignal) =>
    api
      .get<{ items: LocaleHit[] }>(`/ad-accounts/${adAccountId}/targeting/locales`, undefined, { signal })
      .then((r) => r.items),
  leadForms: (adAccountId: string, metaPageId: string, signal?: AbortSignal) =>
    api
      .get<{
        items: LeadFormDto[];
      }>(`/ad-accounts/${adAccountId}/pages/${metaPageId}/lead-forms`, undefined, { signal })
      .then((r) => r.items),
};

/** Look-ups are optional helpers: only transient failures are retried once (the UI offers manual input). */
const retryTransient = (count: number, error: unknown) =>
  count < 1 && isApiError(error, 'NETWORK_ERROR', 'INTERNAL_ERROR');

export function useLocales(adAccountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.adAccounts.locales(adAccountId ?? ''),
    queryFn: ({ signal }) => targetingApi.locales(adAccountId as string, signal),
    enabled: !!adAccountId,
    staleTime: 24 * 3600_000,
    gcTime: 24 * 3600_000,
    retry: retryTransient,
  });
}

/** Interest search; call with an already debounced query (the API allows 120 searches per minute). */
export function useInterestSearch(adAccountId: string | null | undefined, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.adAccounts.interests(adAccountId ?? '', q.toLowerCase()),
    queryFn: ({ signal }) => targetingApi.interests(adAccountId as string, q, signal),
    enabled: !!adAccountId && q.length >= INTEREST_MIN_QUERY,
    staleTime: 3600_000,
    placeholderData: keepPreviousData,
    retry: retryTransient,
  });
}

export function useLeadForms(adAccountId: string | null | undefined, metaPageId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.adAccounts.leadForms(adAccountId ?? '', metaPageId ?? ''),
    queryFn: ({ signal }) => targetingApi.leadForms(adAccountId as string, metaPageId as string, signal),
    enabled: !!adAccountId && !!metaPageId && /^\d{5,25}$/.test(metaPageId),
    staleTime: 60_000,
    retry: retryTransient,
  });
}
