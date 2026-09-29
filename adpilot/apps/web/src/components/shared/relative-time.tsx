'use client';

import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatRelative, toDate } from '@/lib/utils/format';

/** "5 min ago" with the absolute timestamp in a tooltip. */
export function RelativeTime({
  value,
  className,
  fallback = '—',
}: {
  value: string | Date | null | undefined;
  className?: string;
  fallback?: string;
}) {
  const date = toDate(value);
  if (!date) return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;
  return (
    <SimpleTooltip content={formatDateTime(date, { seconds: true })}>
      <time dateTime={date.toISOString()} className={cn('whitespace-nowrap tabular-nums', className)}>
        {formatRelative(date)}
      </time>
    </SimpleTooltip>
  );
}
