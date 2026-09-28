import type { LaunchJobStatus } from '@adpilot/shared';
import { StatusBadge, type BadgeVariant } from '@/components/ui/badge';

export const LAUNCH_STATUS: Record<LaunchJobStatus, { label: string; tone: BadgeVariant }> = {
  QUEUED: { label: 'Queued', tone: 'info' },
  VALIDATING: { label: 'Validating', tone: 'info' },
  UPLOADING_CREATIVES: { label: 'Uploading media', tone: 'info' },
  CREATING_CAMPAIGN: { label: 'Creating campaign', tone: 'info' },
  CREATING_ADSETS: { label: 'Creating ad sets', tone: 'info' },
  CREATING_ADS: { label: 'Creating ads', tone: 'info' },
  VERIFYING: { label: 'Verifying', tone: 'info' },
  ACTIVATING: { label: 'Activating', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  PARTIAL_FAILURE: { label: 'Partially failed', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
};

export function LaunchStatusBadge({ status, size }: { status: LaunchJobStatus; size?: 'sm' | 'default' }) {
  const meta = LAUNCH_STATUS[status] ?? { label: status, tone: 'muted' as const };
  return <StatusBadge status={status} label={meta.label} tone={meta.tone} size={size} />;
}
