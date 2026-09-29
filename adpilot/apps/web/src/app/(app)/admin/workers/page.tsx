import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MonitoringPage } from '@/features/admin-ops/monitoring-page';
import { RequirePermission } from '@/features/auth/require-permission';

export const metadata: Metadata = { title: 'Monitoring' };

export default function AdminMonitoringPage() {
  return (
    <RequirePermission anyOf={['admin.workers.view', 'admin.storage.manage', 'admin.backups.manage']}>
      <Suspense>
        <MonitoringPage />
      </Suspense>
    </RequirePermission>
  );
}
