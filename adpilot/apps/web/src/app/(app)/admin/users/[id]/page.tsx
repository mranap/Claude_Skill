import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { UserDetailPage } from '@/features/admin-users/user-detail-page';

export const metadata: Metadata = { title: 'User details' };

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="admin.users.view">
      <UserDetailPage id={id} />
    </RequirePermission>
  );
}
