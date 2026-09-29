import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConfirmEmailView } from '@/features/auth/confirm-email-view';

export const metadata: Metadata = { title: 'Confirm e-mail' };

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailView />
    </Suspense>
  );
}
