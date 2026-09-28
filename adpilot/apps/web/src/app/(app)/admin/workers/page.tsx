import { Cpu } from 'lucide-react';
import type { Metadata } from 'next';
import { SectionPlaceholder } from '@/components/shared/section-placeholder';
import { RequirePermission } from '@/features/auth/require-permission';

export const metadata: Metadata = { title: 'Workers & Queues' };

export default function AdminWorkersPage() {
  return (
    <RequirePermission permission="admin.workers.view">
      <SectionPlaceholder
        title="Workers & Queues"
        description="Background workers, queues and the scheduler."
        icon={Cpu}
        highlights={[
          'Queue depth, throughput and failures',
          'Retry or remove failed jobs',
          'Pause and resume queues',
          'Scheduler heartbeat and next runs',
        ]}
      />
    </RequirePermission>
  );
}
