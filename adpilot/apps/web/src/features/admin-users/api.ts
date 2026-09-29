import type {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  roleCreateSchema,
  roleUpdateSchema,
} from '@adpilot/shared';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import type {
  AdminUserDetail,
  AdminUserListItem,
  OkResponse,
  Paginated,
  PermissionDto,
  RoleDto,
} from '@/lib/api/types';

export const adminUsersApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) =>
    api.get<Paginated<AdminUserListItem>>('/admin/users', params, { signal }),
  get: (id: string) => api.get<AdminUserDetail>(`/admin/users/${id}`),
  create: (body: z.output<typeof adminCreateUserSchema>) => api.post<AdminUserDetail>('/admin/users', body),
  update: (id: string, body: z.output<typeof adminUpdateUserSchema>) =>
    api.patch<AdminUserDetail>(`/admin/users/${id}`, body),
  block: (id: string, reason?: string) =>
    api.post<OkResponse>(`/admin/users/${id}/block`, reason ? { reason } : {}),
  unblock: (id: string) => api.post<OkResponse>(`/admin/users/${id}/unblock`),
  resetPassword: (id: string, body: z.output<typeof adminResetPasswordSchema>) =>
    api.post<OkResponse>(`/admin/users/${id}/reset-password`, body),
  reset2fa: (id: string) => api.post<OkResponse>(`/admin/users/${id}/reset-2fa`),
  revokeAllSessions: (id: string) => api.post<OkResponse>(`/admin/users/${id}/sessions/revoke`),
  revokeSession: (id: string, sessionId: string) =>
    api.delete<OkResponse>(`/admin/users/${id}/sessions/${sessionId}`),
  remove: (id: string) => api.delete<OkResponse>(`/admin/users/${id}`),
};

export const rolesApi = {
  list: () => api.get<RoleDto[]>('/admin/roles'),
  permissions: () => api.get<PermissionDto[]>('/admin/roles/permissions'),
  create: (body: z.output<typeof roleCreateSchema>) => api.post<RoleDto>('/admin/roles', body),
  update: (id: string, body: z.output<typeof roleUpdateSchema>) =>
    api.patch<RoleDto>(`/admin/roles/${id}`, body),
  remove: (id: string) => api.delete<OkResponse>(`/admin/roles/${id}`),
};
