import type { AuthUserDto } from '@adpilot/shared';
import { api } from '@/lib/api/client';
import type {
  LoginEventDto,
  OkResponse,
  Paginated,
  RecoveryCodesResponse,
  SessionDto,
  TwoFactorSetupResponse,
} from '@/lib/api/types';

export const accountApi = {
  updateProfile: (body: { name?: string | null; timezone?: string }) =>
    api.patch<AuthUserDto>('/account/profile', body),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<OkResponse>('/account/password', body),
  changeEmail: (body: { newEmail: string; password: string }) => api.post<OkResponse>('/account/email', body),
  sessions: () => api.get<SessionDto[]>('/account/sessions'),
  revokeSession: (id: string) => api.delete<OkResponse>(`/account/sessions/${id}`),
  revokeOtherSessions: () => api.post<{ revoked: number }>('/account/sessions/revoke-others'),
  loginHistory: (params: Record<string, string | number>) =>
    api.get<Paginated<LoginEventDto>>('/account/login-history', params),
  setup2fa: () => api.post<TwoFactorSetupResponse>('/account/2fa/setup'),
  enable2fa: (code: string) => api.post<RecoveryCodesResponse>('/account/2fa/enable', { code }),
  disable2fa: (body: { password: string; code: string }) =>
    api.post<OkResponse>('/account/2fa/disable', body),
  regenerateRecoveryCodes: (code: string) =>
    api.post<RecoveryCodesResponse>('/account/2fa/recovery-codes', { code }),
};
