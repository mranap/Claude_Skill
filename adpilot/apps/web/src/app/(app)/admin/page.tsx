import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { AdminDashboard } from '@/features/admin-dashboard/admin-dashboard';

export const metadata: Metadata = { title: 'Admin dashboard' };

export default function AdminDashboardPage() {
  return (
    <RequirePermission permission="admin.dashboard.view">
      <AdminDashboard />
    </RequirePermission>
  );
}
