import {
  AD_ACCOUNT_STATUS_DISPLAY,
  META_PROFILE_STATUS_LABELS,
  type AdAccountStatusKey,
  type MetaProfileStatus,
  type StatusTone,
} from '@adpilot/shared';
import { StatusBadge, type BadgeVariant } from '@/components/ui/badge';
import { humanize } from '@/lib/utils/strings';

/** Maps the shared StatusTone (success/danger/warning/neutral/info) onto badge variants. */
export function toneToVariant(tone: StatusTone | string | null | undefined): BadgeVariant {
  switch (tone) {
    case 'success':
      return 'success';
    case 'danger':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'muted';
  }
}

export function AdAccountStatusBadge({
  statusKey,
  label,
  tone,
  size,
}: {
  statusKey: AdAccountStatusKey | null | undefined;
  label?: string;
  tone?: StatusTone;
  size?: 'sm' | 'default';
}) {
  const display = AD_ACCOUNT_STATUS_DISPLAY[statusKey ?? 'UNKNOWN'] ?? AD_ACCOUNT_STATUS_DISPLAY.UNKNOWN;
  return <StatusBadge status={statusKey} label={label ?? display.label} tone={toneToVariant(tone ?? display.tone)} size={size} />;
}

export function MetaProfileStatusBadge({ status, size }: { status: MetaProfileStatus; size?: 'sm' | 'default' }) {
  return <StatusBadge status={status} label={META_PROFILE_STATUS_LABELS[status] ?? humanize(status)} size={size} />;
}

/** Meta delivery status (effective_status) of campaigns, ad sets and ads. */
const EFFECTIVE_STATUS: Record<string, { label: string; tone: BadgeVariant }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  PAUSED: { label: 'Paused', tone: 'muted' },
  CAMPAIGN_PAUSED: { label: 'Campaign paused', tone: 'muted' },
  ADSET_PAUSED: { label: 'Ad set paused', tone: 'muted' },
  IN_PROCESS: { label: 'In process', tone: 'info' },
  PENDING_REVIEW: { label: 'In review', tone: 'info' },
  PREAPPROVED: { label: 'Pre-approved', tone: 'info' },
  WITH_ISSUES: { label: 'With issues', tone: 'warning' },
  PENDING_BILLING_INFO: { label: 'Billing needed', tone: 'warning' },
  DISAPPROVED: { label: 'Rejected', tone: 'danger' },
  ARCHIVED: { label: 'Archived', tone: 'muted' },
  DELETED: { label: 'Deleted', tone: 'muted' },
};

export const EFFECTIVE_STATUS_OPTIONS = Object.entries(EFFECTIVE_STATUS).map(([value, v]) => ({ value, label: v.label }));

export function EffectiveStatusBadge({ status, size }: { status: string | null | undefined; size?: 'sm' | 'default' }) {
  const known = status ? EFFECTIVE_STATUS[status] : undefined;
  return <StatusBadge status={status} label={known?.label ?? humanize(status ?? 'Unknown')} tone={known?.tone ?? 'muted'} size={size} />;
}

export function effectiveStatusLabel(status: string | null | undefined): string {
  return (status && EFFECTIVE_STATUS[status]?.label) || humanize(status ?? 'Unknown');
}
