'use client';

import { CircleCheck, CircleX } from 'lucide-react';
import type { DataTableColumn } from '@/components/shared/data-table';
import { RelativeTime } from '@/components/shared/relative-time';
import { SimpleTooltip } from '@/components/ui/tooltip';
import type { LoginEventDto } from '@/lib/api/types';
import { formatDateTime } from '@/lib/utils/format';
import { humanize } from '@/lib/utils/strings';
import { describeUserAgent } from '@/lib/utils/user-agent';

const REASONS: Record<string, string> = {
  password: 'Password',
  'password+totp': 'Password + 2FA',
  password_ok_mfa_pending: 'Password OK, 2FA pending',
  bad_password: 'Wrong password',
  unknown_email: 'Unknown e-mail',
  locked: 'Account locked',
  blocked: 'Account blocked',
  bad_totp: 'Invalid 2FA code',
};

export function loginReason(reason: string | null): string {
  if (!reason) return '—';
  return REASONS[reason] ?? humanize(reason);
}

/** Columns for login-history tables (Settings → Security, admin user detail). */
export const loginEventColumns: DataTableColumn<LoginEventDto>[] = [
  {
    id: 'time',
    header: 'Time',
    cell: (e) => (
      <div className="flex flex-col">
        <span className="tabular-nums">{formatDateTime(e.createdAt)}</span>
        <RelativeTime value={e.createdAt} className="text-xs text-muted-foreground" />
      </div>
    ),
  },
  {
    id: 'result',
    header: 'Result',
    cell: (e) => (
      <span className="inline-flex items-center gap-1.5">
        {e.success ? (
          <CircleCheck className="size-4 text-success-fg" aria-label="Success" />
        ) : (
          <CircleX className="size-4 text-destructive-fg" aria-label="Failed" />
        )}
        <span className={e.success ? undefined : 'text-destructive-fg'}>{loginReason(e.reason)}</span>
      </span>
    ),
  },
  {
    id: 'ip',
    header: 'IP address',
    cell: (e) => <span className="font-mono text-[13px]">{e.ip ?? '—'}</span>,
  },
  {
    id: 'device',
    header: 'Device',
    cell: (e) => (
      <SimpleTooltip content={e.userAgent ?? 'Unknown user agent'}>
        <span className="text-muted-foreground">{describeUserAgent(e.userAgent).label}</span>
      </SimpleTooltip>
    ),
  },
];
