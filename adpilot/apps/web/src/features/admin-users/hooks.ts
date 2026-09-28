'use client';

import { SYSTEM_ROLES } from '@adpilot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import type { RoleDto } from '@/lib/api/types';
import { adminUsersApi, rolesApi } from './api';

export function useAdminUsers(params: Record<string, string | number>) {
  return useQuery({
    queryKey: queryKeys.admin.users.list(params),
    queryFn: ({ signal }) => adminUsersApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminUser(id: string) {
  return useQuery({ queryKey: queryKeys.admin.users.detail(id), queryFn: () => adminUsersApi.get(id) });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: queryKeys.admin.roles, queryFn: rolesApi.list, staleTime: 60_000, enabled });
}

export function usePermissionCatalog() {
  return useQuery({ queryKey: queryKeys.admin.permissions, queryFn: rolesApi.permissions, staleTime: 5 * 60_000 });
}

/** Roles with administrative permissions can only be assigned/managed by a Super Admin. */
export function isPrivilegedRole(role: Pick<RoleDto, 'key' | 'permissions'> | undefined): boolean {
  if (!role) return false;
  return role.key === SYSTEM_ROLES.SUPER_ADMIN || role.permissions.some((p) => p.startsWith('admin.'));
}
