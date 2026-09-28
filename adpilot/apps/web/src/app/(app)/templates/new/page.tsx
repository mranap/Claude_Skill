import type { Metadata } from 'next';
import { RequirePermission } from '@/features/auth/require-permission';
import { TemplateEditorPage } from '@/features/templates/template-editor';

export const metadata: Metadata = { title: 'New template' };

export default function NewTemplateRoute() {
  return (
    <RequirePermission permission="app.templates.manage">
      <TemplateEditorPage />
    </RequirePermission>
  );
}
