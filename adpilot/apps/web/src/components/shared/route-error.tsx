'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** Body of the `error.tsx` boundaries: friendly message, retry and a way out. */
export function RouteError({ error, retry, fullPage = false }: { error: Error & { digest?: string }; retry: () => void; fullPage?: boolean }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={fullPage ? 'flex min-h-dvh items-center justify-center px-4' : 'flex min-h-[50vh] items-center justify-center'}>
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive-fg">
          <TriangleAlert className="size-5" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">Something went wrong</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          This part of the page failed to load. You can try again — if the problem persists, contact support and mention
          the reference below.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Button onClick={retry}>
            <RotateCcw />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
