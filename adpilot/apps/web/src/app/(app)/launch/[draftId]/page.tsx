import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { LaunchWizardPage } from '@/features/launch/wizard/launch-wizard';

export const metadata: Metadata = { title: 'Launch wizard' };

export default async function LaunchDraftRoute({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return (
    <RequirePermission permission="app.campaigns.launch">
      <LaunchWizardPage draftId={draftId} />
    </RequirePermission>
  );
}
