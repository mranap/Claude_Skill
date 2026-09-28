'use client';

import { NOTIFICATION_TYPE_LABELS, type NotificationSeverity } from '@adpilot/shared';
import { ArrowUpRight, CircleAlert, CircleCheck, Info, Mail, Send, TriangleAlert, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { SimpleTooltip } from '@/components/ui/tooltip';
import type { DeliveryStatus, NotificationDeliveryDto, NotificationDto } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { humanize, safeHref } from '@/lib/utils/strings';

const SEVERITY: Record<NotificationSeverity, { icon: LucideIcon; className: string; label: string }> = {
  INFO: { icon: Info, className: 'bg-info/10 text-info-fg', label: 'Info' },
  SUCCESS: { icon: CircleCheck, className: 'bg-success/10 text-success-fg', label: 'Success' },
  WARNING: { icon: TriangleAlert, className: 'bg-warning/15 text-warning-fg', label: 'Warning' },
  ERROR: { icon: CircleAlert, className: 'bg-destructive/10 text-destructive-fg', label: 'Error' },
};

export function SeverityIcon({ severity, className }: { severity: NotificationSeverity; className?: string }) {
  const s = SEVERITY[severity] ?? SEVERITY.INFO;
  const Icon = s.icon;
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', s.className, className)} aria-label={s.label}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

const DELIVERY_TONE: Record<DeliveryStatus, BadgeVariant> = {
  PENDING: 'muted',
  SENDING: 'info',
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'muted',
  UNCERTAIN: 'warning',
};

export function DeliveryBadges({ deliveries, className }: { deliveries: NotificationDeliveryDto[]; className?: string }) {
  if (!deliveries.length) {
    return (
      <Badge variant="outline" size="sm" className={cn('text-muted-foreground', className)}>
        In-app only
      </Badge>
    );
  }
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {deliveries.map((d) => {
        const Icon = d.channel === 'EMAIL' ? Mail : Send;
        return (
          <SimpleTooltip
            key={d.channel}
            content={`${d.channel === 'EMAIL' ? 'E-mail' : 'Telegram'}: ${humanize(d.status)}${d.sentAt ? ` · ${formatDateTime(d.sentAt)}` : ''}`}
          >
            <Badge variant={DELIVERY_TONE[d.status] ?? 'muted'} size="sm">
              <Icon aria-hidden />
              {d.channel === 'EMAIL' ? 'Email' : 'Telegram'} · {humanize(d.status)}
            </Badge>
          </SimpleTooltip>
        );
      })}
    </span>
  );
}

/**
 * One notification row. Used by the header popover (compact) and the Notification Center.
 * Clicking marks it read; when it carries a safe link the title navigates there.
 */
export function NotificationItem({
  notification,
  compact = false,
  onOpen,
  actions,
}: {
  notification: NotificationDto;
  compact?: boolean;
  /** Called when the item is activated (mark as read + close the popover). */
  onOpen?: (notification: NotificationDto) => void;
  actions?: React.ReactNode;
}) {
  const unread = !notification.readAt;
  const link = safeHref(notification.link);
  const typeLabel = NOTIFICATION_TYPE_LABELS[notification.type]?.label ?? humanize(notification.type);

  const title = (
    <span className={cn('text-sm leading-snug', unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90')}>
      {notification.title}
    </span>
  );

  return (
    <div
      className={cn(
        'group relative flex gap-3 transition-colors',
        compact ? 'rounded-md px-2.5 py-2.5 hover:bg-accent/60' : 'px-4 py-4 sm:px-5',
        unread && !compact && 'bg-primary/[0.025]',
      )}
    >
      <SeverityIcon severity={notification.severity} className={compact ? 'size-7' : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {link && !link.external ? (
              <Link
                href={link.href}
                onClick={() => onOpen?.(notification)}
                className="rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {title}
              </Link>
            ) : link?.external ? (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpen?.(notification)}
                className="inline-flex items-center gap-1 rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {title}
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </a>
            ) : onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(notification)}
                className="rounded-sm text-left outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {title}
              </button>
            ) : (
              title
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SimpleTooltip content={formatDateTime(notification.createdAt, { seconds: true })}>
              <time
                dateTime={notification.createdAt}
                className="relative z-10 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
              >
                {formatRelative(notification.createdAt)}
              </time>
            </SimpleTooltip>
            {unread ? <span className="size-2 rounded-full bg-primary" aria-label="Unread" /> : null}
          </div>
        </div>
        <p className={cn('mt-0.5 text-[13px] leading-relaxed text-muted-foreground', compact ? 'line-clamp-2' : 'whitespace-pre-line')}>
          {notification.body}
        </p>
        {!compact ? (
          <div className="relative z-10 mt-2.5 flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="sm" className="text-muted-foreground">
              {typeLabel}
            </Badge>
            <DeliveryBadges deliveries={notification.deliveries} />
            {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
