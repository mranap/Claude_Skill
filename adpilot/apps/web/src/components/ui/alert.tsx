import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';

const alertVariants = cva(
  'relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground [&>svg]:text-muted-foreground',
        info: 'border-info/30 bg-info/[0.06] text-foreground [&>svg]:text-info-fg',
        success: 'border-success/30 bg-success/[0.07] text-foreground [&>svg]:text-success-fg',
        warning: 'border-warning/40 bg-warning/[0.08] text-foreground [&>svg]:text-warning-fg',
        destructive:
          'border-destructive/30 bg-destructive/[0.06] text-foreground [&>svg]:text-destructive-fg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const defaultIcons = {
  default: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
} as const;

export function Alert({
  className,
  variant,
  icon,
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants> & { icon?: React.ReactNode | false }) {
  const Icon = defaultIcons[variant ?? 'default'];
  return (
    <div
      data-slot="alert"
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon === false ? <span /> : (icon ?? <Icon aria-hidden />)}
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('font-medium leading-5 tracking-tight', className)}
      {...props}
    />
  );
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-sm leading-relaxed text-muted-foreground [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}
