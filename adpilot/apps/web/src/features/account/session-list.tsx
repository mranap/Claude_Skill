'use client';

import { Globe, Laptop, LogOut, Smartphone, Tablet } from 'lucide-react';
import type * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { RelativeTime } from '@/components/shared/relative-time';
import type { SessionDto } from '@/lib/api/types';
import { formatDate } from '@/lib/utils/format';
import { describeUserAgent } from '@/lib/utils/user-agent';

const DEVICE_ICONS = { desktop: Laptop, mobile: Smartphone, tablet: Tablet, unknown: Globe } as const;

/** Sessions list shared by Settings → Security and the admin user page. */
export function SessionList({
  sessions,
  onRevoke,
  revokingId,
  canRevoke = true,
  empty,
}: {
  sessions: SessionDto[];
  onRevoke?: (session: SessionDto) => void;
  revokingId?: string | null;
  canRevoke?: boolean;
  empty?: React.ReactNode;
}) {
  if (!sessions.length) return <>{empty ?? <p className="text-sm text-muted-foreground">No active sessions.</p>}</>;
  return (
    <ul className="divide-y rounded-lg border">
      {sessions.map((session) => {
        const device = describeUserAgent(session.userAgent);
        const Icon = DEVICE_ICONS[device.kind];
        return (
          <li key={session.id} className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <SimpleTooltip content={session.userAgent ?? 'Unknown user agent'}>
                    <span className="truncate">{device.label}</span>
                  </SimpleTooltip>
                  {session.current ? (
                    <Badge variant="success" size="sm">
                      This device
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-mono">{session.ip ?? 'Unknown IP'}</span>
                  <span aria-hidden>·</span>
                  <span>
                    Active <RelativeTime value={session.lastUsedAt} />
                  </span>
                  <span aria-hidden>·</span>
                  <span>Signed in {formatDate(session.createdAt)}</span>
                </p>
              </div>
            </div>
            {onRevoke && canRevoke && !session.current ? (
              <Button
                variant="outline"
                size="sm"
                className="self-start sm:self-auto"
                onClick={() => onRevoke(session)}
                loading={revokingId === session.id}
              >
                <LogOut />
                Sign out
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
