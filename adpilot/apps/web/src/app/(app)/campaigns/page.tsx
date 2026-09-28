import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { CampaignsPage } from '@/features/campaigns/campaigns-page';
import { READ_ACCESS } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Campaigns' };

export default function Page() {
  return (
    <RequirePermission anyOf={READ_ACCESS.campaigns}>
      <Suspense>
        <CampaignsPage />
      </Suspense>
    </RequirePermission>
  );
}
