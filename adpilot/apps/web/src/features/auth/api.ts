import type { AuthUserDto, LoginResponse } from '@adpilot/shared';
import { api } from '@/lib/api/client';
import type { OkResponse } from '@/lib/api/types';

export interface ResetTokenValidation {
  valid: boolean;
  purpose?: 'RESET' | 'INVITE';
}

/** GET /auth/session: a probe that never answers 401. */
export type SessionProbe =
  { authenticated: true; user: AuthUserDto } | { authenticated: false; refreshable: boolean };

export const authApi = {
  me: (signal?: AbortSignal) => api.get<AuthUserDto>('/auth/me', undefined, { signal }),
  session: (signal?: AbortSignal) =>
    api.get<SessionProbe>('/auth/session', undefined, { signal, auth: false }),
  login: (body: { email: string; password: string }) => api.post<LoginResponse>('/auth/login', body),
  verifyMfa: (body: { ticket: string; code: string }) =>
    api.post<{ status: 'OK'; user: AuthUserDto }>('/auth/login/2fa', body),
  logout: () => api.post<OkResponse>('/auth/logout', undefined, { auth: false }),
  forgotPassword: (email: string) => api.post<OkResponse>('/auth/password/forgot', { email }),
  /** POST so the one-time token never appears in URLs or access logs. */
  validateResetToken: (token: string) =>
    api.post<ResetTokenValidation>('/auth/password/reset/validate', { token }),
  resetPassword: (body: { token: string; password: string }) =>
    api.post<OkResponse>('/auth/password/reset', body),
  confirmEmail: (token: string) => api.post<OkResponse>('/auth/email/confirm', { token }),
};
