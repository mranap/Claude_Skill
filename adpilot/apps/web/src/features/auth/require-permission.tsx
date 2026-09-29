'use client';

import type { PermissionKey } from '@adpilot/shared';
import type * as React from 'react';
import { AccessDenied } from '@/components/shared/access-denied';
import { useAuth } from './auth-context';

/**
 * Client-side page guard (the API enforces the same permissions; this only avoids rendering a page whose
 * requests would all fail with FORBIDDEN). `permission` requires all listed permissions, `anyOf` any one.
 */
export function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: PermissionKey | PermissionKey[];
  anyOf?: readonly PermissionKey[];
  children: React.ReactNode;
}) {
  const { can, canAny } = useAuth();
  if ((permission && !can(permission)) || (anyOf && !canAny(anyOf))) return <AccessDenied />;
  return <>{children}</>;
}
