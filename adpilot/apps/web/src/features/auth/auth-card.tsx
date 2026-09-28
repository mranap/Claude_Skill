import type * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

/** Centered card used by every public authentication page. */
export function AuthCard({
  title,
  description,
  icon,
  children,
  footer,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_32px_-12px_rgb(0_0_0/0.12)] dark:shadow-none', className)}>
      <div className="flex flex-col gap-1.5 px-6 pt-7 pb-1 sm:px-8">
        {icon ? (
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary-fg [&_svg]:size-5">
            {icon}
          </div>
        ) : null}
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <div className="text-sm leading-relaxed text-muted-foreground">{description}</div> : null}
      </div>
      {children ? <div className="px-6 pt-5 pb-7 sm:px-8">{children}</div> : <div className="pb-6" />}
      {footer ? <div className="border-t px-6 py-4 text-center text-sm text-muted-foreground sm:px-8">{footer}</div> : null}
    </Card>
  );
}
