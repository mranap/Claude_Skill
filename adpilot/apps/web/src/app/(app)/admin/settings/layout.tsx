import type * as React from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsNav } from '@/features/admin-settings/settings-nav';
import { RequirePermission } from '@/features/auth/require-permission';

export default function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequirePermission permission="admin.settings.view">
      <PageHeader
        title="System settings"
        description="Platform-wide configuration. Each section is saved separately; secrets are write-only."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </RequirePermission>
  );
}
