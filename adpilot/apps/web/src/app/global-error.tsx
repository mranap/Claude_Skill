'use client';

import './globals.css';

/** Replaces the root layout when it fails; renders its own document (no providers are available). */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background px-4 font-sans text-foreground antialiased">
        <title>Something went wrong · AdPilot</title>
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">AdPilot could not load</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An unexpected error occurred. Please try again. If it keeps happening, contact support.
          </p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={retry}
            className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
