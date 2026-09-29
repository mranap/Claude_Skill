import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { LaunchJobPage } from '@/features/launch/job-page';

export const metadata: Metadata = { title: 'Launch progress' };

export default async function LaunchJobRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="app.campaigns.launch">
      <LaunchJobPage id={id} />
    </RequirePermission>
  );
}
