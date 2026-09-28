import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { ProfileDetailPage } from '@/features/meta-profiles/profile-detail-page';

export const metadata: Metadata = { title: 'Meta profile' };

export default async function MetaProfileRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="app.meta_profiles.manage">
      <ProfileDetailPage id={id} />
    </RequirePermission>
  );
}
