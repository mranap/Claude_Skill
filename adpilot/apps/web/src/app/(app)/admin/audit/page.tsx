import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { AuditPage } from '@/features/admin-logs/audit-page';

export const metadata: Metadata = { title: 'Audit log' };

export default function AdminAuditPage() {
  return (
    <RequirePermission permission="admin.audit.view">
      <Suspense>
        <AuditPage />
      </Suspense>
    </RequirePermission>
  );
}
