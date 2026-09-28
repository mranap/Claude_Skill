import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { ProfilesPage } from '@/features/meta-profiles/profiles-page';

export const metadata: Metadata = { title: 'Meta accounts' };

export default function MetaProfilesRoute() {
  return (
    <RequirePermission permission="app.meta_profiles.manage">
      <ProfilesPage />
    </RequirePermission>
  );
}
