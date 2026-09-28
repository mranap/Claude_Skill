import type { Metadata } from 'next';
import { UiKit } from '@/features/dev/ui-kit';

export const metadata: Metadata = { title: 'UI kit' };

/** Component gallery for developers (the `(dev)` layout answers 404 in production). */
export default function UiKitPage() {
  return <UiKit />;
}
