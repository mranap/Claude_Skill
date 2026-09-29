import type { Metadata } from 'next';
import { TemplatesPage } from '@/features/templates/templates-page';

export const metadata: Metadata = { title: 'Templates' };

export default function TemplatesRoute() {
  return <TemplatesPage />;
}
