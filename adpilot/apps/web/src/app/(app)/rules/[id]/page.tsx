import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/features/auth/require-permission';
import { RuleDetailPage } from '@/features/rules/rule-detail-page';

export const metadata: Metadata = { title: 'Rule' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="app.rules.manage">
      <Suspense>
        <RuleDetailPage id={id} />
      </Suspense>
    </RequirePermission>
  );
}
