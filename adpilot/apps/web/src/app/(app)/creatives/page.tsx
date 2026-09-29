import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CreativesPage } from '@/features/creatives/creatives-page';

export const metadata: Metadata = { title: 'Creatives' };

export default function CreativesRoute() {
  return (
    <Suspense>
      <CreativesPage />
    </Suspense>
  );
}
