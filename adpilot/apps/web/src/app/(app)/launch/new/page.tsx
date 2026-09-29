import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { NewLaunchPage } from '@/features/launch/new-launch';

export const metadata: Metadata = { title: 'New launch' };

export default function NewLaunchRoute() {
  return (
    <RequirePermission permission="app.campaigns.launch">
      <NewLaunchPage />
    </RequirePermission>
  );
}
