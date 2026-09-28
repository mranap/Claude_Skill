'use client';

import { RouteError } from '@/components/shared/route-error';

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} fullPage />;
}
