import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { StatisticsPage } from '@/features/statistics/statistics-page';

export const metadata: Metadata = { title: 'Statistics' };

export default function Page() {
  return (
    <RequirePermission permission="app.statistics.view">
      <Suspense>
        <StatisticsPage />
      </Suspense>
    </RequirePermission>
  );
}
