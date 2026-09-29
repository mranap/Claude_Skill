import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { BroadcastsPage } from '@/features/admin-broadcasts/broadcasts-page';

export const metadata: Metadata = { title: 'Broadcasts' };

export default function AdminBroadcastsPage() {
  return (
    <RequirePermission permission="admin.broadcast.send">
      <Suspense>
        <BroadcastsPage />
      </Suspense>
    </RequirePermission>
  );
}
