import type { Metadata } from 'next';
import { TemplateEditorPage } from '@/features/templates/template-editor';

export const metadata: Metadata = { title: 'Template' };

export default async function TemplateRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditorPage id={id} />;
}
