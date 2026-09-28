import type * as React from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsNav } from '@/features/account/settings-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="Manage your profile, security, notifications and appearance." className="mb-4" />
      <SettingsNav />
      {children}
    </>
  );
}
