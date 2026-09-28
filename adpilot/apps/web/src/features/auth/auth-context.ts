'use client';

import type { AuthUserDto, PermissionKey } from '@adpilot/shared';
import { createContext, useContext } from 'react';

export interface AuthContextValue {
  user: AuthUserDto;
  isSuperAdmin: boolean;
  /** True when the user holds every listed permission (SUPER_ADMIN always passes). */
  can: (permission: PermissionKey | readonly PermissionKey[]) => boolean;
  /** True when the user holds at least one of the permissions. */
  canAny: (permissions: readonly PermissionKey[]) => boolean;
  signOut: () => Promise<void>;
  /** Maintenance message when the API answered MAINTENANCE for this user. */
  maintenanceMessage: string | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
