import type { Metadata } from 'next';
import { AccountDetailPage } from '@/features/ad-accounts/account-detail-page';
import { RequirePermission } from '@/features/auth/require-permission';
import { READ_ACCESS } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Ad account' };

export default async function AdAccountRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission anyOf={READ_ACCESS.adAccounts}>
      <AccountDetailPage id={id} />
    </RequirePermission>
  );
}
