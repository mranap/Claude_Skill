import type { Metadata } from 'next';
import { PageHeader } from '@/components/shared/page-header';
import { RequirePermission } from '@/features/auth/require-permission';
import { RuleEditor } from '@/features/rules/rule-editor';

export const metadata: Metadata = { title: 'New rule' };

export default function Page() {
  return (
    <RequirePermission permission="app.rules.manage">
      <PageHeader
        breadcrumbs={[{ label: 'Auto Rules', href: '/rules' }, { label: 'New rule' }]}
        title="New rule"
        description="Choose what the rule watches, when it acts and what it does. Start with a dry run to see what it would change."
      />
      <RuleEditor />
    </RequirePermission>
  );
}
