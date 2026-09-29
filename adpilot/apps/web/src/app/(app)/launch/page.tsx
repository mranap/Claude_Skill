import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { LaunchHub } from '@/features/launch/launch-hub';

export const metadata: Metadata = { title: 'Launch' };

export default function LaunchRoute() {
  return (
    <RequirePermission permission="app.campaigns.launch">
      <LaunchHub />
    </RequirePermission>
  );
}
