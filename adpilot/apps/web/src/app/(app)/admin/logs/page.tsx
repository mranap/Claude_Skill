import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { LogsPage } from '@/features/admin-logs/logs-page';

export const metadata: Metadata = { title: 'Logs' };

export default function AdminLogsPage() {
  return (
    <RequirePermission permission="admin.logs.view">
      <Suspense>
        <LogsPage />
      </Suspense>
    </RequirePermission>
  );
}
