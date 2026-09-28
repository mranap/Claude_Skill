import type * as React from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider } from '@/features/auth/auth-provider';

/**
 * Authenticated area. Authentication is decided on the client by AuthProvider (the access cookie lives
 * 15 minutes and the refresh cookie is path-restricted, so a server-side check would be unreliable).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
