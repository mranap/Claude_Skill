import { notFound } from 'next/navigation';
import type * as React from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider } from '@/features/auth/auth-provider';

// Evaluated per request, before anything is streamed, so production answers with a real 404 status.
export const dynamic = 'force-dynamic';

/** Development-only pages (component gallery). They share the authenticated shell but do not exist in production. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
