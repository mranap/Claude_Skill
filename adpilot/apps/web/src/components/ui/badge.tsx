import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { humanize } from '@/lib/utils/strings';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-md border font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-primary/20 bg-primary/10 text-primary-fg',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-foreground',
        success: 'border-success/25 bg-success/10 text-success-fg',
        warning: 'border-warning/35 bg-warning/12 text-warning-fg',
        danger: 'border-destructive/25 bg-destructive/10 text-destructive-fg',
        info: 'border-info/25 bg-info/10 text-info-fg',
        muted: 'border-border bg-muted text-muted-foreground',
      },
      size: {
        sm: 'h-5 px-1.5 text-[11px]',
        default: 'h-[22px] px-2 text-xs',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/** Status → tone mapping shared by every table and detail page. Unknown statuses render as muted. */
const STATUS_TONES: Record<string, BadgeVariant> = {
  // users / generic
  ACTIVE: 'success',
  ENABLED: 'success',
  BLOCKED: 'danger',
  DELETED: 'muted',
  DISABLED: 'muted',
  LOCKED: 'warning',
  // jobs / deliveries / syncs
  SUCCESS: 'success',
  SENT: 'success',
  COMPLETED: 'success',
  VERIFIED: 'success',
  CREATED: 'success',
  READY: 'success',
  QUEUED: 'info',
  PENDING: 'warning',
  RUNNING: 'info',
  SENDING: 'info',
  PROCESSING: 'info',
  IN_FLIGHT: 'info',
  UPLOADING: 'info',
  IDLE: 'muted',
  SKIPPED: 'muted',
  CANCELLED: 'muted',
  UNCERTAIN: 'warning',
  PARTIAL_FAILURE: 'warning',
  FAILED: 'danger',
  ERROR: 'danger',
  // Meta profiles / tokens
  UNCHECKED: 'muted',
  EXPIRED: 'danger',
  INVALID: 'danger',
  PERMISSION_REVOKED: 'danger',
  // log levels
  DEBUG: 'muted',
  INFO: 'info',
  WARN: 'warning',
  WARNING: 'warning',
  // drafts
  DRAFT: 'muted',
  LAUNCHED: 'success',
  ARCHIVED: 'muted',
};

const DOT_TONES: Record<BadgeVariant, string> = {
  default: 'bg-primary',
  secondary: 'bg-muted-foreground',
  outline: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  muted: 'bg-muted-foreground/60',
};

export function statusTone(status: string | null | undefined): BadgeVariant {
  return (status && STATUS_TONES[status.toUpperCase()]) || 'muted';
}

export function StatusBadge({
  status,
  label,
  tone,
  size,
  className,
  dot = true,
}: {
  status: string | null | undefined;
  /** Overrides the humanised status text. */
  label?: React.ReactNode;
  tone?: BadgeVariant;
  size?: 'sm' | 'default';
  className?: string;
  dot?: boolean;
}) {
  const variant = tone ?? statusTone(status);
  return (
    <Badge variant={variant} size={size} className={className}>
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', DOT_TONES[variant])} /> : null}
      {label ?? humanize(status ?? 'Unknown')}
    </Badge>
  );
}
