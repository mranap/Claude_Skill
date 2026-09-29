import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/cn';

export interface StatDelta {
  /** Relative change in percent (e.g. 12.5 for +12.5 %). */
  value: number;
  label?: string;
  /** Set to false for metrics where going up is bad (cost per result, errors). */
  positiveIsGood?: boolean;
}

export function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  hint,
  loading = false,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: StatDelta;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const direction = !delta || delta.value === 0 ? 'flat' : delta.value > 0 ? 'up' : 'down';
  const good = direction === 'flat' ? null : (direction === 'up') === (delta?.positiveIsGood ?? true);
  const DeltaIcon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  return (
    <Card className={cn('gap-0 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden /> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-24" />
      ) : (
        <div className="mt-1.5 truncate text-2xl leading-9 font-semibold tracking-tight tabular-nums">
          {value}
        </div>
      )}
      {(delta || hint) && !loading ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {delta ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium tabular-nums',
                good === null ? 'text-muted-foreground' : good ? 'text-success-fg' : 'text-destructive-fg',
              )}
            >
              <DeltaIcon className="size-3.5" aria-hidden />
              {`${delta.value > 0 ? '+' : ''}${delta.value.toFixed(Math.abs(delta.value) < 10 ? 1 : 0)}%`}
            </span>
          ) : null}
          {delta?.label || hint ? (
            <span className="text-muted-foreground">{delta?.label ?? hint}</span>
          ) : null}
        </div>
      ) : loading ? (
        <Skeleton className="mt-2 h-3.5 w-32" />
      ) : null}
    </Card>
  );
}
