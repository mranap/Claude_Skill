import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { RolesPage } from '@/features/admin-users/roles-page';

export const metadata: Metadata = { title: 'Roles & Permissions' };

export default function AdminRolesPage() {
  return (
    <RequirePermission permission="admin.users.view">
      <Suspense>
        <RolesPage />
      </Suspense>
    </RequirePermission>
  );
}
