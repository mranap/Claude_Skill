import { Compass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 text-center">
      <Logo className="mb-10" />
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-card text-muted-foreground">
        <Compass className="size-5" />
      </div>
      <p className="text-sm font-medium text-primary-fg">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        The page you’re looking for doesn’t exist or was moved. Check the address or head back to your
        dashboard.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/settings/profile">Account settings</Link>
        </Button>
      </div>
    </div>
  );
}
