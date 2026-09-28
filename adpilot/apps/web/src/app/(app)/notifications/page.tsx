import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotificationCenter } from '@/features/notifications/notification-center';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <Suspense>
      <NotificationCenter />
    </Suspense>
  );
}
