import type { Metadata } from 'next';
import { AccountsPage } from '@/features/ad-accounts/accounts-page';
import { RequirePermission } from '@/features/auth/require-permission';
import { READ_ACCESS } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Ad accounts' };

export default function AdAccountsRoute() {
  return (
    <RequirePermission anyOf={READ_ACCESS.adAccounts}>
      <AccountsPage />
    </RequirePermission>
  );
}
