import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { RulesPage } from '@/features/rules/rules-page';

export const metadata: Metadata = { title: 'Auto Rules' };

export default function Page() {
  return (
    <RequirePermission permission="app.rules.manage">
      <Suspense>
        <RulesPage />
      </Suspense>
    </RequirePermission>
  );
}
