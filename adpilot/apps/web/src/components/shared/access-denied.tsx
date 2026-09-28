import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from './empty-state';

export function AccessDenied({
  title = 'You don’t have access to this page',
  description = 'Your role does not include the permission required here. Ask a Super Admin if you need access.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Card>
      <EmptyState
        icon={ShieldAlert}
        title={title}
        description={description}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </Card>
  );
}
