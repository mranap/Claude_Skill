'use client';

import type { SettingKey } from '@adpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type {
  AdminSettingGroup,
  AdminSettingsResponse,
  MetaConnectivityResult,
  OkResponse,
  TelegramBotTestResult,
} from '@/lib/api/types';

export type SecretPatch = Record<string, string | null>;

export const adminSettingsApi = {
  all: () => api.get<AdminSettingsResponse>('/admin/settings'),
  update: <K extends SettingKey>(key: K, values: Record<string, unknown>, secrets: SecretPatch = {}) =>
    api.put<AdminSettingGroup<K> & { _saved?: boolean }>(`/admin/settings/${key}`, { values, secrets }),
  verifySmtp: () => api.post<OkResponse>('/admin/settings/smtp/verify'),
  testSmtp: (to?: string) =>
    api.post<{ ok: boolean; messageId?: string }>('/admin/settings/smtp/test', to ? { to } : {}),
  testTelegram: () => api.post<TelegramBotTestResult>('/admin/settings/telegram/test'),
  testMeta: () => api.post<MetaConnectivityResult>('/admin/settings/meta/test'),
};

export function useAdminSettings() {
  return useQuery({ queryKey: queryKeys.admin.settings, queryFn: adminSettingsApi.all, staleTime: 60_000 });
}

/** Saves one settings group and writes the server's answer back into the settings cache. */
export function useSaveSettings<K extends SettingKey>(key: K) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ values, secrets }: { values: Record<string, unknown>; secrets?: SecretPatch }) =>
      adminSettingsApi.update(key, values, secrets),
    onSuccess: (updated) => {
      const { _saved: _ignored, ...group } = updated;
      queryClient.setQueryData<AdminSettingsResponse>(queryKeys.admin.settings, (old) =>
        old ? { ...old, [key]: group } : old,
      );
    },
  });
}

/** Keeps only the fields that belong to the zod schema (drops `<secret>Set` flags). */
export function pickSchemaValues<T extends Record<string, unknown>>(
  shape: Record<string, unknown>,
  values: T,
): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) out[key] = values[key];
  return out as T;
}

/** `secrets.<name>` field errors of a failed settings save (e.g. SMTP asks to re-enter its password). */
export function secretErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const fe of error.fieldErrors)
    if (fe.path.startsWith('secrets.')) out[fe.path.slice('secrets.'.length)] = fe.message;
  return out;
}

/** Secret edits: undefined/'' → keep (not sent), string → replace, null → clear. */
export function secretPatch(state: Record<string, string | null | undefined>): SecretPatch {
  const out: SecretPatch = {};
  for (const [field, value] of Object.entries(state)) {
    if (value === null) out[field] = null;
    else if (typeof value === 'string' && value.length > 0) out[field] = value;
  }
  return out;
}
