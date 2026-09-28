import Link from 'next/link';
import type * as React from 'react';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(56rem_28rem_at_50%_-6rem,color-mix(in_oklab,var(--primary)_13%,transparent),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(40rem_24rem_at_50%_0%,black,transparent)] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:44px_44px] opacity-60"
      />
      <div className="flex justify-end p-3 sm:p-4">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 flex-col items-center px-4 pt-4 pb-12 sm:justify-center sm:pt-0 sm:pb-24">
        <div className="w-full max-w-[400px]">
          <Link href="/login" className="mx-auto mb-8 flex w-fit rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            <Logo />
          </Link>
          {children}
          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
            AdPilot uses the official Meta Marketing API. Your tokens are encrypted at rest.
          </p>
        </div>
      </main>
    </div>
  );
}
