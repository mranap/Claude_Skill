import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { CampaignDetailPage } from '@/features/campaigns/campaign-detail-page';
import { READ_ACCESS } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Campaign' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission anyOf={READ_ACCESS.campaigns}>
      <Suspense>
        <CampaignDetailPage id={id} />
      </Suspense>
    </RequirePermission>
  );
}
