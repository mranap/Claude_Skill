import type * as React from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils/cn';

export interface KeyValueItem {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Adds a copy button with this text. */
  copy?: string | null;
  mono?: boolean;
  hidden?: boolean;
}

/** Definition list for detail pages: label on the left, value on the right. */
export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn('divide-y text-sm', className)}>
      {items
        .filter((item) => !item.hidden)
        .map((item, index) => (
          <div key={index} className="grid grid-cols-[minmax(7.5rem,38%)_1fr] items-start gap-4 py-2.5 first:pt-0 last:pb-0">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                'flex min-w-0 items-center gap-1 text-foreground',
                item.mono && 'font-mono text-[13px]',
              )}
            >
              <span className="min-w-0 break-words">
                {item.value === null || item.value === undefined || item.value === '' ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  item.value
                )}
              </span>
              {item.copy ? <CopyButton value={item.copy} className="-my-1" /> : null}
            </dd>
          </div>
        ))}
    </dl>
  );
}
