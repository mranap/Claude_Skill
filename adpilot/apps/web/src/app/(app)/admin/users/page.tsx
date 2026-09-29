import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { UsersPage } from '@/features/admin-users/users-page';

export const metadata: Metadata = { title: 'Users' };

export default function AdminUsersPage() {
  return (
    <RequirePermission permission="admin.users.view">
      <Suspense>
        <UsersPage />
      </Suspense>
    </RequirePermission>
  );
}
